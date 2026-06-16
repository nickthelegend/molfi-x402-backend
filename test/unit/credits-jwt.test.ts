import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signCreditToken, verifyCreditToken } from '../../src/credits/jwt.js';
import { env } from '../../src/env.js';

describe('credits-jwt.test.ts - Credits JWT token signing and verification', () => {
  it('should round-trip sign and verify a credit token successfully', () => {
    const userId = 'user-12345';
    const credits = 50;

    const token = signCreditToken(userId, credits);
    expect(token).toBeDefined();

    const decoded = verifyCreditToken(token);
    expect(decoded.sub).toBe(userId);
    expect(decoded.credits).toBe(credits);
  });

  it('should reject tokens signed with a different key', () => {
    const payload = { sub: 'user-123', credits: 10 };
    const badToken = jwt.sign(payload, 'wrong-secret-key-that-is-at-least-32-bytes-long', { expiresIn: '5m', algorithm: 'HS256' });

    expect(() => verifyCreditToken(badToken)).toThrow();
  });

  it('should reject expired tokens', () => {
    // Manually create an expired token
    const payload = { sub: 'user-123', credits: 10, exp: Math.floor(Date.now() / 1000) - 10 }; // expired 10 seconds ago
    const expiredToken = jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256' });

    expect(() => verifyCreditToken(expiredToken)).toThrow(/jwt expired/);
  });
});
