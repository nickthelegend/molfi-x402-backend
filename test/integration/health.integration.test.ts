import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { Server } from 'http';
import mongoose from 'mongoose';
import { env } from '../../src/env.js';

describe('health.integration.test.ts - /health endpoint integration', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
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

  it('should return health status, chain ID 43113, and operator info', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    // Note: It might return 200 or 500 depending on balance status, but let's parse the JSON.
    const json = (await res.json()) as {
      ok: boolean;
      chain?: number;
      operator?: string;
      error?: string;
    };

    if (res.status === 200) {
      expect(json.ok).toBe(true);
      expect(json.chain).toBe(43113);
      expect(json.operator).toBeDefined();
      expect(json.operator).toMatch(/^0x[a-fA-F0-9]{40}$/);
    } else {
      expect(res.status).toBe(500);
      expect(json.ok).toBe(false);
      expect(json.error).toBeDefined();
    }
  });
});
