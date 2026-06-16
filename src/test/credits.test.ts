import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { app } from '../app.js';
import { Server } from 'http';
import { signCreditToken, verifyCreditToken } from '../credits/jwt.js';
import { getUserCredits, addUserCredits, decrementUserCredits, User, AdView, connectDb } from '../credits/store.js';

describe('Credits and Ads Tests', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 8787 : address?.port || 8787;
        resolve();
      });
    });
    await connectDb();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(async () => {
    const testIds = [
      '0x1234567890123456789012345678901234567890',
      'test-user-atomic',
      '0xtestusercreditssuccess',
      '0xtestuserchat',
      '0xtestusernocredits'
    ];
    await User.deleteMany({ _id: { $in: testIds } });
    await AdView.deleteMany({ user_id: { $in: testIds } });
  });

  it('JWT sign and verify round-trip works', () => {
    const userId = '0x1234567890123456789012345678901234567890';
    const credits = 10;
    const token = signCreditToken(userId, credits);
    const decoded = verifyCreditToken(token);
    expect(decoded.sub).toBe(userId);
    expect(decoded.credits).toBe(credits);
  });

  it('Credit decrement is atomic and prevents overdraft', async () => {
    const userId = 'test-user-atomic';
    await addUserCredits(userId, 5);

    const s1 = await decrementUserCredits(userId, 3);
    expect(s1).toBe(true);
    expect(await getUserCredits(userId)).toBe(2);

    const s2 = await decrementUserCredits(userId, 3);
    expect(s2).toBe(false);
    expect(await getUserCredits(userId)).toBe(2);
  });

  it('GET /v1/ads returns the list of ads', async () => {
    const res = await fetch(`http://localhost:${port}/v1/ads`);
    expect(res.status).toBe(200);
    const ads = (await res.json()) as Array<{ id: string; durationMs: number }>;
    expect(ads.length).toBeGreaterThan(0);
    expect(ads[0]).toHaveProperty('id');
    expect(ads[0]).toHaveProperty('durationMs');
  });

  it('POST /v1/ads/claim rejects short watch duration', async () => {
    const res = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: 'avax-subnets',
        watchedMs: 5000,
        walletAddress: '0xTestUserCredits',
      }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('Ad watch duration too short');
  });

  it('POST /v1/ads/claim processes valid claim and increments balance', async () => {
    const res = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: 'avax-subnets',
        watchedMs: 15000,
        walletAddress: '0xTestUserCreditsSuccess',
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { jwt: string; credits: number };
    expect(json).toHaveProperty('jwt');
    expect(json.credits).toBe(5);

    const balanceRes = await fetch(`http://localhost:${port}/v1/credits/balance`, {
      headers: { Authorization: `Bearer ${json.jwt}` },
    });
    expect(balanceRes.status).toBe(200);
    const balanceJson = (await balanceRes.json()) as { credits: number };
    expect(balanceJson.credits).toBe(5);
  });

  it('Completions with bearer token decrements credits and streams', async () => {
    const claimRes = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: 'avax-subnets',
        watchedMs: 15000,
        walletAddress: '0xTestUserChat',
      }),
    });
    const claimJson = (await claimRes.json()) as { jwt: string };

    const completionsRes = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${claimJson.jwt}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'test credit call' }],
      }),
    });

    expect(completionsRes.status).toBe(200);

    const finalBalance = await getUserCredits('0xtestuserchat');
    expect(finalBalance).toBe(4);
  });

  it('Completions with bearer token but insufficient credits returns 402', async () => {
    const claimRes = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: 'avax-subnets',
        watchedMs: 15000,
        walletAddress: '0xTestUserNoCredits',
      }),
    });
    const claimJson = (await claimRes.json()) as { jwt: string };

    await decrementUserCredits('0xtestusernocredits', 5);

    const completionsRes = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${claimJson.jwt}`,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4.5',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(completionsRes.status).toBe(402);
    const errJson = (await completionsRes.json()) as { error: string };
    expect(errJson.error).toContain('Insufficient credits');
  });
});
