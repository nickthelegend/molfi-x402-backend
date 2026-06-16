import jwt from 'jsonwebtoken';
import { env } from '../env.js';
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
