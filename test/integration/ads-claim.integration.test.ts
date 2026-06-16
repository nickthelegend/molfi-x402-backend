import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { Server } from 'http';
import mongoose from 'mongoose';
import { env } from '../../src/env.js';
import { User } from '../../src/credits/store.js';

describe('ads-claim.integration.test.ts - Ad Claims & Balance Integration', () => {
  let server: Server;
  let port: number;
  const walletAddress = '0x1111111111111111111111111111111111111111';

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(env.MONGODB_URI);
    }
    // Clean up test user credits
    await User.deleteOne({ _id: walletAddress.toLowerCase() });

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 8787 : address?.port || 8787;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await User.deleteOne({ _id: walletAddress.toLowerCase() });
    await mongoose.disconnect();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('should flow end-to-end: fetch ads -> claim credit -> check balance', async () => {
    // 1. Get ads list
    const adsRes = await fetch(`http://localhost:${port}/v1/ads`);
    expect(adsRes.status).toBe(200);
    const ads = (await adsRes.json()) as Array<{ id: string; durationMs: number; credits: number }>;
    expect(ads.length).toBeGreaterThan(0);

    const targetAd = ads[0];

    // 2. Claim credits for that ad
    const claimRes = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: targetAd.id,
        watchedMs: targetAd.durationMs, // fully watched
        walletAddress: walletAddress,
      }),
    });

    expect(claimRes.status).toBe(200);
    const claimJson = (await claimRes.json()) as { jwt: string; credits: number };
    expect(claimJson.credits).toBe(targetAd.credits);
    expect(claimJson.jwt).toBeDefined();

    // 3. Verify balance using the token
    const balanceRes = await fetch(`http://localhost:${port}/v1/credits/balance`, {
      headers: {
        'Authorization': `Bearer ${claimJson.jwt}`,
      },
    });

    expect(balanceRes.status).toBe(200);
    const balanceJson = (await balanceRes.json()) as { credits: number };
    expect(balanceJson.credits).toBe(targetAd.credits);
  });
});
