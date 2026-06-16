import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { connectDb } from '../credits/store.js';
import { Campaign, Impression } from '../marketers/models.js';
import { pickAd } from '../ads/auction.js';

describe('Ad Auction Tests', () => {
  beforeAll(async () => {
    await connectDb();
  });

  beforeEach(async () => {
    await Campaign.deleteMany({});
    await Impression.deleteMany({});
    vi.restoreAllMocks();
  });

  it('skips campaigns over budget', async () => {
    // 1. Create a campaign with budget fully spent
    const c1 = new Campaign({
      marketerId: '0xmarketer1',
      title: 'Spent Campaign',
      type: 'video',
      creativeUrl: 'http://test.com/1.mp4',
      durationMs: 15000,
      ctaUrl: 'http://test.com/1',
      bidPerViewUsdc: '0.050000',
      budgetUsdc: '10.000000',
      spentUsdc: '10.000000', // fully spent
      status: 'active',
      targeting: { surfaces: ['frontend'] },
      frequencyCapPerSessionPer4h: 1,
    });
    await c1.save();

    // 2. Create an active campaign with remaining budget
    const c2 = new Campaign({
      marketerId: '0xmarketer2',
      title: 'Active Campaign',
      type: 'video',
      creativeUrl: 'http://test.com/2.mp4',
      durationMs: 15000,
      ctaUrl: 'http://test.com/2',
      bidPerViewUsdc: '0.050000',
      budgetUsdc: '10.000000',
      spentUsdc: '1.000000', // remaining budget
      status: 'active',
      targeting: { surfaces: ['frontend'] },
      frequencyCapPerSessionPer4h: 1,
    });
    await c2.save();

    const ad = await pickAd({
      surface: 'frontend',
      viewerSessionHash: 'session-xyz',
    });

    expect(ad).toBeDefined();
    expect(ad._id.toString()).toBe(c2._id.toString());
  });

  it('applies frequency cap', async () => {
    const c1 = new Campaign({
      marketerId: '0xmarketer1',
      title: 'Ad 1',
      type: 'video',
      creativeUrl: 'http://test.com/1.mp4',
      durationMs: 15000,
      ctaUrl: 'http://test.com/1',
      bidPerViewUsdc: '0.050000',
      budgetUsdc: '10.000000',
      spentUsdc: '0.000000',
      status: 'active',
      targeting: { surfaces: ['frontend'] },
      frequencyCapPerSessionPer4h: 1,
    });
    await c1.save();

    // Mock a claimed impression in the last 1 hour
    const imp = new Impression({
      _id: new mongoose.Types.ObjectId().toString(),
      token: 'token-abc',
      campaignId: c1._id.toString(),
      marketerId: '0xmarketer1',
      viewerSessionHash: 'session-user-1',
      surface: 'frontend',
      type: 'video',
      durationMs: 15000,
      startedAt: new Date(Date.now() - 3600 * 1000),
      completedAt: new Date(Date.now() - 3600 * 1000),
      status: 'claimed',
      bidPaidUsdc: '0.050000',
    });
    await imp.save();

    const ad = await pickAd({
      surface: 'frontend',
      viewerSessionHash: 'session-user-1', // same viewer hash
    });

    // Should return null since c1 is seen and no other ads exist
    expect(ad).toBeNull();
  });

  it('distributes traffic with 10% fairness floor', async () => {
    const c1 = {
      _id: new mongoose.Types.ObjectId(),
      marketerId: '0xmarketer1',
      title: 'High Bid Ad',
      type: 'video',
      creativeUrl: 'http://test.com/1.mp4',
      durationMs: 15000,
      ctaUrl: 'http://test.com/1',
      bidPerViewUsdc: '0.100000',
      budgetUsdc: '100.000000',
      spentUsdc: '0.000000',
      status: 'active',
      targeting: { surfaces: ['frontend'] },
      frequencyCapPerSessionPer4h: 1,
    };

    const c2 = {
      _id: new mongoose.Types.ObjectId(),
      marketerId: '0xmarketer2',
      title: 'Low Bid Ad',
      type: 'video',
      creativeUrl: 'http://test.com/2.mp4',
      durationMs: 15000,
      ctaUrl: 'http://test.com/2',
      bidPerViewUsdc: '0.010000',
      budgetUsdc: '100.000000',
      spentUsdc: '0.000000',
      status: 'active',
      targeting: { surfaces: ['frontend'] },
      frequencyCapPerSessionPer4h: 1,
    };

    // Spy on Campaign.find and Impression.find to return mocked data immediately
    vi.spyOn(Campaign, 'find').mockImplementation(() => {
      return {
        lean: () => Promise.resolve([c1, c2])
      } as any;
    });

    vi.spyOn(Impression, 'find').mockImplementation(() => {
      return {
        lean: () => Promise.resolve([])
      } as any;
    });

    let c2PickedCount = 0;
    const iterations = 500;
    for (let i = 0; i < iterations; i++) {
      const ad = await pickAd({
        surface: 'frontend',
        viewerSessionHash: `session-${i}`,
      });
      if (ad && ad._id.toString() === c2._id.toString()) {
        c2PickedCount++;
      }
    }

    const pickedPercent = c2PickedCount / iterations;
    // Expected pick probability of c2: 0.9 * (0.01 / 0.11) + 0.1 / 2 = ~13%
    expect(pickedPercent).toBeGreaterThan(0.04);
    expect(pickedPercent).toBeLessThan(0.25);
  });
});
