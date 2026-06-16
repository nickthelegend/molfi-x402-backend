import { Router } from 'express';
import { ADS_REGISTRY } from './registry.js';
import { verifyAdClaimRateLimit } from '../credits/rate-limit.js';
import { getUserCredits, addUserCredits, logAdView } from '../credits/store.js';
import { signCreditToken, verifyCreditToken } from '../credits/jwt.js';
import { logger } from '../lib/logger.js';
import { recordAdClaimImpression } from '../marketers/impressions.js';
export const adsRouter = Router();
adsRouter.get('/v1/ads', (req, res) => {
    res.json(ADS_REGISTRY);
});
adsRouter.post('/v1/ads/claim', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!verifyAdClaimRateLimit(ip)) {
        res.status(429).json({ error: 'Please wait before claiming credits again.' });
        return;
    }
    const { adId, watchedMs, walletAddress } = req.body;
    if (!adId || watchedMs === undefined) {
        res.status(400).json({ error: 'adId and watchedMs are required' });
        return;
    }
    const ad = ADS_REGISTRY.find((a) => a.id === adId);
    if (!ad) {
        res.status(404).json({ error: `Ad not found with ID: ${adId}` });
        return;
    }
    const minWatch = ad.durationMs * 0.95;
    const maxWatch = ad.durationMs + 2000;
    if (watchedMs < minWatch) {
        res.status(400).json({
            error: `Ad watch duration too short: watched ${watchedMs}ms, expected at least ${minWatch}ms`,
        });
        return;
    }
    if (watchedMs > maxWatch) {
        res.status(400).json({ error: 'Ad watch duration exceeded logical max (time travel detected).' });
        return;
    }
    const userId = (walletAddress ? walletAddress : ip).toLowerCase();
    const newBalance = await addUserCredits(userId, ad.credits);
    await logAdView(userId, ad.id, watchedMs);
    // Marketers impression log hook
    recordAdClaimImpression(ad.id, watchedMs, walletAddress, ip).catch((err) => {
        logger.error(`Failed to record ad claim impression: ${err.message}`);
    });
    logger.info(`Credited user ${userId} with ${ad.credits} credits (new balance: ${newBalance})`);
    const token = signCreditToken(userId, newBalance);
    res.json({
        jwt: token,
        credits: newBalance,
    });
});
adsRouter.get('/v1/credits/balance', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authorization header with Bearer token is required' });
        return;
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = verifyCreditToken(token);
        const credits = await getUserCredits(decoded.sub);
        res.json({ credits });
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid or expired credit token' });
    }
});
