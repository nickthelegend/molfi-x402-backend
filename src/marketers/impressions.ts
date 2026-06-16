import mongoose from 'mongoose';
import { Campaign, Impression, Marketer } from './models.js';
import { computeLeafHash, anchorBatch } from './settlement.js';
import { logger } from '../lib/logger.js';
import { keccak256, stringToHex } from 'viem';

export async function recordAdClaimImpression(adId: string, watchedMs: number, walletAddress?: string, ipAddress?: string): Promise<void> {
  logger.info(`recordAdClaimImpression hook triggered for adId: ${adId}`);

  // Find an active campaign to link to, or create one for testing if none exist
  let campaign = await Campaign.findOne({ status: 'active' });
  if (!campaign) {
    logger.info('No active campaign found. Creating a default test campaign...');
    // Ensure a test marketer exists
    const testMarketerAddress = '0x635ee3EE5D1bADA3c2EF9b3A4a6c741a8460AeBE'.toLowerCase();
    let marketer = await Marketer.findById(testMarketerAddress);
    if (!marketer) {
      marketer = new Marketer({
        _id: testMarketerAddress,
        name: 'Default Test Marketer',
        balanceUsdc: '100.000000',
      });
      await marketer.save();
    }

    campaign = new Campaign({
      marketerId: testMarketerAddress,
      mp4Url: 'https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-blockchain-nodes-43034-large.mp4',
      durationMs: 15000,
      ctaUrl: 'https://molfi.fun',
      bidPerViewUsdc: '0.010000',
      budgetUsdc: '10.000000',
      spentUsdc: '0.000000',
      status: 'active',
      frequencyCap: 0,
    });
    await campaign.save();
  }

  const bid = parseFloat(campaign.bidPerViewUsdc);
  const budget = parseFloat(campaign.budgetUsdc);
  const spent = parseFloat(campaign.spentUsdc);

  if (spent + bid > budget) {
    logger.warn(`Campaign ${campaign._id} has hit its budget. Setting to depleted.`);
    campaign.status = 'depleted';
    await campaign.save();
    return;
  }

  // Deduct bid from budget and add to spent
  const newSpent = spent + bid;
  campaign.spentUsdc = newSpent.toFixed(6);
  if (newSpent >= budget) {
    campaign.status = 'depleted';
  }
  await campaign.save();

  // Session hash to anonymize user IP
  const viewerSessionHash = keccak256(stringToHex(`${ipAddress || 'unknown'}-${Date.now()}`));
  const impressionId = new mongoose.Types.ObjectId().toString();

  const impression = new Impression({
    _id: impressionId,
    campaignId: campaign._id.toString(),
    viewerSessionHash,
    viewerWallet: walletAddress ? walletAddress.toLowerCase() : undefined,
    watchedMs,
    completedAt: new Date(),
    leafHash: 'placeholder',
  });

  // Calculate leaf hash
  const leafHash = computeLeafHash({
    _id: impression._id,
    campaignId: impression.campaignId,
    viewerSessionHash: impression.viewerSessionHash,
    watchedMs: impression.watchedMs,
    completedAt: impression.completedAt,
  });

  impression.leafHash = leafHash;
  await impression.save();

  logger.info(`Log impression ${impression._id} for campaign ${campaign._id}. Spent: ${campaign.spentUsdc}/${campaign.budgetUsdc}`);

  // Check batch trigger: 50 impressions, or 3 for testing
  const pendingCount = await Impression.countDocuments({ batchId: { $exists: false } });
  logger.info(`Pending impressions to anchor: ${pendingCount}`);
  
  if (pendingCount >= 50 || (process.env.NODE_ENV === 'test' && pendingCount >= 3)) {
    logger.info('In-memory threshold reached, anchoring batch...');
    await anchorBatch();
  }
}
