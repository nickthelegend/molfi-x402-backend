import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { randomUUID } from 'node:crypto';
export function mintCredit(impressionId, sessionHash) {
    const claims = {
        jti: randomUUID(),
        sub: sessionHash,
        imp: impressionId,
        amt: 1,
        exp: Math.floor(Date.now() / 1000) + 5 * 60,
    };
    return jwt.sign(claims, env.JWT_SECRET, { algorithm: 'HS256' });
}
export function signCreditToken(userId, currentCredits) {
    const payload = {
        sub: userId,
        credits: currentCredits,
    };
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '5m', algorithm: 'HS256' });
}
export function verifyCreditToken(token) {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
}
