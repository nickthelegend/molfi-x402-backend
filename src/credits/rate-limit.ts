import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const ipChatLimiter = new Map<string, RateLimitEntry>();
const adClaimLimiter = new Map<string, number>();

export function chatRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const limitWindow = 60 * 1000; // 1 minute
  const limitCount = 60;

  const current = ipChatLimiter.get(ip);
  if (!current || now > current.resetTime) {
    ipChatLimiter.set(ip, {
      count: 1,
      resetTime: now + limitWindow,
    });
    return next();
  }

  if (current.count >= limitCount) {
    res.status(429).json({ error: 'Too many chat requests. Limit is 60 requests per minute.' });
    return;
  }

  current.count += 1;
  next();
}

export function verifyAdClaimRateLimit(ip: string): boolean {
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  const now = Date.now();
  const lastClaim = adClaimLimiter.get(ip);
  if (lastClaim && now - lastClaim < 10000) {
    return false;
  }
  adClaimLimiter.set(ip, now);
  return true;
}
