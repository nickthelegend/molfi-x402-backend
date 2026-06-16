import jwt from 'jsonwebtoken';
import { env } from '../env.js';

export interface CreditJwtPayload {
  sub: string;
  credits: number;
}

export function signCreditToken(userId: string, currentCredits: number): string {
  const payload: CreditJwtPayload = {
    sub: userId,
    credits: currentCredits,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '5m', algorithm: 'HS256' });
}

export function verifyCreditToken(token: string): CreditJwtPayload {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as CreditJwtPayload;
}
