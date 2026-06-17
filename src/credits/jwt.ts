import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { randomUUID } from 'node:crypto';

export interface CreditClaims {
  jti: string;                // unique token id; primary key in spent collection
  sub: string;                // viewer session hash
  imp: string;                // impressionId — provenance audit
  amt: number;                // 1 credit
  exp: number;                // 5 minutes expiry
}

export function mintCredit(impressionId: string, sessionHash: string): string {
  const claims: CreditClaims = {
    jti: randomUUID(),
    sub: sessionHash,
    imp: impressionId,
    amt: 1,
    exp: Math.floor(Date.now() / 1000) + 24 * 3600,
  };
  return jwt.sign(claims, env.JWT_SECRET, { algorithm: 'HS256' });
}

export function signCreditToken(userId: string, currentCredits: number): string {
  const payload = {
    sub: userId,
    credits: currentCredits,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
}

export function verifyCreditToken(token: string): any {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
}
