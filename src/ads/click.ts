import crypto from 'node:crypto';
import { env } from '../env.js';

export function signClickToken(impressionId: string): string {
  const payload = `${impressionId}.${Date.now()}`;
  const sig = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 16);
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyClickToken(token: string): { impressionId: string; timestamp: number } {
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  const parts = decoded.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }
  const [impressionId, ts, sig] = parts;
  const expect = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${impressionId}.${ts}`)
    .digest('hex')
    .slice(0, 16);
  if (sig !== expect) {
    throw new Error('Invalid token signature');
  }
  return { impressionId, timestamp: parseInt(ts, 10) };
}
