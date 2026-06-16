import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { connectDb } from '../credits/store.js';
import { SpentCredit } from '../marketers/models.js';
import { mintCredit, verifyCreditToken } from '../credits/jwt.js';
import { redeem } from '../credits/redeem.js';
import { env } from '../env.js';

describe('Credit Redemption Tests', () => {
  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    // Keep connection open
  });

  beforeEach(async () => {
    await SpentCredit.deleteMany({});
  });

  it('mints valid jwt and redeems successfully', async () => {
    const impId = new mongoose.Types.ObjectId().toString();
    const sessionHash = 'session-hash-xyz';

    const token = mintCredit(impId, sessionHash);
    const claims = verifyCreditToken(token);
    expect(claims.imp).toBe(impId);
    expect(claims.sub).toBe(sessionHash);

    const redeemedClaims = await redeem(token);
    expect(redeemedClaims.jti).toBe(claims.jti);

    // Verify spent credit DB record exists
    const spent = await SpentCredit.findOne({ jti: claims.jti });
    expect(spent).toBeDefined();
    expect(spent?.imp).toBe(impId);
  });

  it('rejects same jti twice (concurrent double-spend race condition)', async () => {
    const impId = new mongoose.Types.ObjectId().toString();
    const sessionHash = 'session-hash-abc';
    const token = mintCredit(impId, sessionHash);

    // Call redeem twice in parallel
    const results = await Promise.allSettled([
      redeem(token),
      redeem(token),
    ]);

    const fulfilledCount = results.filter(r => r.status === 'fulfilled').length;
    const rejectedCount = results.filter(r => r.status === 'rejected').length;

    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toBe('CREDIT_ALREADY_SPENT');
  });

  it('rejects expired jwt', async () => {
    // Manually sign an expired token
    const claims = {
      jti: 'expired-jti-123',
      sub: 'session-hash-exp',
      imp: 'imp-id-exp',
      amt: 1,
      exp: Math.floor(Date.now() / 1000) - 10, // expired 10 seconds ago
    };
    const token = jwt.sign(claims, env.JWT_SECRET, { algorithm: 'HS256' });

    await expect(redeem(token)).rejects.toThrow();
  });
});
