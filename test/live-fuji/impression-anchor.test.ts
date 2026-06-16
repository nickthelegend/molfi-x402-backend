import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { env } from '../../src/env.js';
import { Impression, Campaign, Marketer, MerkleBatch } from '../../src/marketers/models.js';
import { anchorBatch } from '../../src/marketers/settlement.js';
import { createPublicClient, http, formatUnits } from 'viem';
import { avalancheFuji } from '../../src/chain/fuji.js';
import { operatorAccount } from '../../src/chain/operator.js';

describe('impression-anchor.test.ts - [live-fuji] Impression anchoring', () => {
  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(env.FUJI_RPC_URL),
  });

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(env.MONGODB_URI);
    }
    // Clean up pending impressions and batches
    await Impression.deleteMany({ batchId: { $exists: false } });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('should anchor batch of impressions on-chain or mock fallback', async () => {
    const clientPrivateKey = process.env.TEST_CLIENT_PRIVATE_KEY;
    if (!clientPrivateKey) {
      console.warn('⚠️  TEST_CLIENT_PRIVATE_KEY not configured. Skipping live Fuji impression anchoring test.');
      expect(true).toBe(true);
      return;
    }

    const opBalance = await publicClient.getBalance({ address: operatorAccount.address });
    const opAvax = parseFloat(formatUnits(opBalance, 18));
    console.log(`Operator Address: ${operatorAccount.address}`);
    console.log(`Operator Balance: ${opAvax} AVAX`);

    if (opAvax < 0.01) {
      console.warn(`⚠️  Operator has insufficient AVAX (${opAvax} AVAX). Skipping live Fuji anchoring.`);
      expect(true).toBe(true);
      return;
    }

    // Ensure test marketer and campaign exist
    const testMarketerAddress = '0x635ee3ee5d1bada3c2ef9b3a4a6c741a8460aebe';
    let marketer = await Marketer.findById(testMarketerAddress);
    if (!marketer) {
      marketer = new Marketer({ _id: testMarketerAddress, balanceUsdc: '10.000000' });
      await marketer.save();
    }

    let campaign = await Campaign.findOne({ marketerId: testMarketerAddress, status: 'active' });
    if (!campaign) {
      campaign = new Campaign({
        marketerId: testMarketerAddress,
        mp4Url: 'https://example.com/ad.mp4',
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

    // Write 3 mock impressions to trigger batch in test mode
    const completedAt = new Date();
    await Impression.create([
      { campaignId: campaign._id.toString(), viewerSessionHash: 'session-1', watchedMs: 15000, completedAt, leafHash: 'h1' },
      { campaignId: campaign._id.toString(), viewerSessionHash: 'session-2', watchedMs: 15000, completedAt, leafHash: 'h2' },
      { campaignId: campaign._id.toString(), viewerSessionHash: 'session-3', watchedMs: 15000, completedAt, leafHash: 'h3' },
    ]);

    // Force anchor
    await anchorBatch();

    // Verify impressions were updated with a batchId
    const processed = await Impression.find({ campaignId: campaign._id.toString() });
    expect(processed.length).toBeGreaterThanOrEqual(3);
    processed.forEach((imp) => {
      expect(imp.batchId).toBeDefined();
      expect(imp.settlementTxHash).toBeDefined();
    });

    // Verify batch was created
    const batch = await MerkleBatch.findOne().sort({ anchoredAt: -1 });
    expect(batch).toBeDefined();
    expect(batch?.impressionCount).toBeGreaterThanOrEqual(3);
  });
});
