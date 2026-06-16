import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { Server } from 'http';
import { ADS_REGISTRY } from '../../src/ads/registry.js';
import mongoose from 'mongoose';
import { env } from '../../src/env.js';

describe('ads-claim.test.ts - Ad Claims Validation', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    // Connect to mongoose if not already connected
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(env.MONGODB_URI);
    }
    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 8787 : address?.port || 8787;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('should accept claims with valid watchedMs >= 95% of duration', async () => {
    const ad = ADS_REGISTRY[0];
    const watchedMs = ad.durationMs; // 100%

    const res = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adId: ad.id,
        watchedMs,
        walletAddress: '0x0000000000000000000000000000000000000001',
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { jwt: string; credits: number };
    expect(json.jwt).toBeDefined();
    expect(json.credits).toBeGreaterThan(0);
  });

  it('should reject watchedMs < 95% of duration', async () => {
    const ad = ADS_REGISTRY[0];
    const watchedMs = ad.durationMs * 0.94; // 94%

    const res = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adId: ad.id,
        watchedMs,
        walletAddress: '0x0000000000000000000000000000000000000001',
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('Ad watch duration too short');
  });

  it('should reject future-dated/time-travel claims (watchedMs > duration + 2000)', async () => {
    const ad = ADS_REGISTRY[0];
    const watchedMs = ad.durationMs + 2001; // > duration + 2000

    const res = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adId: ad.id,
        watchedMs,
        walletAddress: '0x0000000000000000000000000000000000000001',
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('logical max (time travel detected)');
  });
});
