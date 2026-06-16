import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectDb } from '../credits/store.js';
import { Campaign, Impression, AdHeartbeat } from '../marketers/models.js';
import { verifyClaim, VerificationError } from './verifier.js';

describe('Verifier Tests', () => {
  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    // Keep connection open if other tests need it, but here we can let vitest manage
  });

  beforeEach(async () => {
    await Campaign.deleteMany({});
    await Impression.deleteMany({});
    await AdHeartbeat.deleteMany({});
  });

  const setupMockImpression = async (opts: {
    durationMs: number;
    type: 'video' | 'image';
    startedAtOffsetMs?: number;
  }) => {
    const campaign = new Campaign({
      marketerId: '0xmarketer',
      title: 'Test Campaign',
      type: opts.type,
      creativeUrl: 'http://test.com/ad.mp4',
      durationMs: opts.durationMs,
      ctaUrl: 'http://test.com/cta',
      bidPerViewUsdc: '0.010000',
      budgetUsdc: '10.000000',
      spentUsdc: '0.000000',
      status: 'active',
      targeting: { surfaces: ['frontend'] },
      frequencyCapPerSessionPer4h: 1,
    });
    await campaign.save();

    const startedAt = new Date(Date.now() - (opts.startedAtOffsetMs || opts.durationMs));

    const impression = new Impression({
      _id: new mongoose.Types.ObjectId().toString(),
      token: 'mock-hmac-token-' + Math.random(),
      campaignId: campaign._id.toString(),
      marketerId: '0xmarketer',
      viewerSessionHash: 'viewer-session-123',
      surface: 'frontend',
      type: opts.type,
      durationMs: opts.durationMs,
      startedAt,
      status: 'pending',
      bidPaidUsdc: '0.010000',
    });
    await impression.save();

    return { campaign, impression };
  };

  it('rejects honeypot attempts', async () => {
    const { impression } = await setupMockImpression({ durationMs: 10000, type: 'video' });
    await expect(verifyClaim({
      impressionToken: impression.token,
      watchedMs: 10000,
      lastSeq: 10,
      hp: 'bot-filled-honeypot'
    })).rejects.toThrowError(new VerificationError('HONEYPOT', 'Bot activity detected (honeypot triggered)'));
  });

  it('rejects sparse heartbeats', async () => {
    const { impression } = await setupMockImpression({ durationMs: 14000, type: 'video' });
    // min heartbeats is floor(14000/700) = 20
    // Insert only 10 heartbeats
    for (let seq = 0; seq < 10; seq++) {
      await AdHeartbeat.create({
        impressionId: impression._id,
        seq,
        serverReceivedAt: new Date(impression.startedAt.getTime() + seq * 500),
        elapsedMs: seq * 500,
        visibility: 'visible',
        evidence: { videoCurrentTimeMs: seq * 500, videoPaused: false, videoMuted: false },
      });
    }

    await expect(verifyClaim({
      impressionToken: impression.token,
      watchedMs: 14000,
      lastSeq: 9,
    })).rejects.toThrowError(/Need ≥ 20 heartbeats/);
  });

  it('rejects sequence gaps', async () => {
    const { impression } = await setupMockImpression({ durationMs: 7000, type: 'video' });
    // min heartbeats floor(7000/700) = 10
    // Let's create sequence gap (by altering the seq index, but keeping count to 10)
    for (let i = 0; i < 10; i++) {
      await AdHeartbeat.create({
        impressionId: impression._id,
        seq: i === 5 ? 99 : i, // alter seq at index 5 to 99
        serverReceivedAt: new Date(impression.startedAt.getTime() + i * 500),
        elapsedMs: i * 500,
        visibility: 'visible',
        evidence: { videoCurrentTimeMs: i * 500, videoPaused: false, videoMuted: false },
      });
    }

    await expect(verifyClaim({
      impressionToken: impression.token,
      watchedMs: 7000,
      lastSeq: 9,
    })).rejects.toThrowError(/seq mismatch/);
  });

  it('rejects low visibility', async () => {
    const { impression } = await setupMockImpression({ durationMs: 7000, type: 'video' });
    // min heartbeats 10
    // Insert 10 heartbeats but 2 are paused (visibility check fails)
    for (let seq = 0; seq < 10; seq++) {
      const isPaused = seq >= 8;
      await AdHeartbeat.create({
        impressionId: impression._id,
        seq,
        serverReceivedAt: new Date(impression.startedAt.getTime() + seq * 500),
        elapsedMs: seq * 500,
        visibility: isPaused ? 'hidden' : 'visible',
        evidence: { videoCurrentTimeMs: seq * 500, videoPaused: isPaused, videoMuted: false },
      });
    }

    await expect(verifyClaim({
      impressionToken: impression.token,
      watchedMs: 7000,
      lastSeq: 9,
    })).rejects.toThrowError(/visibility 80.0% < 95%/);
  });

  it('rejects clock drift', async () => {
    const { impression } = await setupMockImpression({ durationMs: 7000, type: 'video' });
    // 10 heartbeats
    for (let seq = 0; seq < 10; seq++) {
      await AdHeartbeat.create({
        impressionId: impression._id,
        seq,
        serverReceivedAt: new Date(impression.startedAt.getTime() + seq * 500),
        elapsedMs: seq * 500,
        visibility: 'visible',
        evidence: { videoCurrentTimeMs: seq * 500, videoPaused: false, videoMuted: false },
      });
    }

    // Server elapsed = 9 * 500 = 4500ms
    // If client watchedMs is 7000ms -> clock drift is Math.abs(4500 - 7000) = 2500ms > 2000ms
    await expect(verifyClaim({
      impressionToken: impression.token,
      watchedMs: 7000,
      lastSeq: 9,
    })).rejects.toThrowError(/client said 7000ms, server saw 4500ms/);
  });

  it('rejects incomplete video watch', async () => {
    // 7000ms duration.
    // Client claims 4500ms watchedMs, server saw 4500ms, but last seq is only at 3500ms currentTime (incomplete).
    const { impression } = await setupMockImpression({ durationMs: 7000, type: 'video', startedAtOffsetMs: 4500 });
    for (let seq = 0; seq < 10; seq++) {
      await AdHeartbeat.create({
        impressionId: impression._id,
        seq,
        serverReceivedAt: new Date(impression.startedAt.getTime() + seq * 500),
        elapsedMs: seq * 500,
        visibility: 'visible',
        evidence: { videoCurrentTimeMs: seq * 400, videoPaused: false, videoMuted: false }, // stopped at 3600ms
      });
    }

    await expect(verifyClaim({
      impressionToken: impression.token,
      watchedMs: 4500,
      lastSeq: 9,
    })).rejects.toThrowError(/video stopped at 3600\/7000ms/);
  });

  it('accepts a fully-valid video heartbeat sequence', async () => {
    const { impression } = await setupMockImpression({ durationMs: 7000, type: 'video', startedAtOffsetMs: 7000 });
    // Create 15 heartbeats (so plenty above min 10)
    for (let seq = 0; seq < 15; seq++) {
      await AdHeartbeat.create({
        impressionId: impression._id,
        seq,
        serverReceivedAt: new Date(impression.startedAt.getTime() + seq * 500),
        elapsedMs: seq * 500,
        visibility: 'visible',
        evidence: { videoCurrentTimeMs: seq * 500, videoPaused: false, videoMuted: false },
      });
    }

    const res = await verifyClaim({
      impressionToken: impression.token,
      watchedMs: 7000,
      lastSeq: 14,
    });
    expect(res).toBeDefined();
    expect(res.status).toBe('pending');
  });

  it('accepts a fully-valid image heartbeat sequence', async () => {
    const { impression } = await setupMockImpression({ durationMs: 5000, type: 'image', startedAtOffsetMs: 5000 });
    // min heartbeats is floor(5000/700) = 7
    for (let seq = 0; seq < 11; seq++) {
      await AdHeartbeat.create({
        impressionId: impression._id,
        seq,
        serverReceivedAt: new Date(impression.startedAt.getTime() + seq * 500),
        elapsedMs: seq * 500,
        visibility: 'visible',
        evidence: { cursorInside: true, scrollIntoView: true },
      });
    }

    const res = await verifyClaim({
      impressionToken: impression.token,
      watchedMs: 5000,
      lastSeq: 10,
    });
    expect(res).toBeDefined();
    expect(res.status).toBe('pending');
  });
});
