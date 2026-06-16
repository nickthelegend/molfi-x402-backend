import { Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../env.js';
import { Marketer, Campaign, Impression, MerkleBatch } from './models.js';
import { generateSessionToken, verifySessionToken, verifySiweSignature } from './auth.js';
import {
  nonceSchema,
  verifySiweSchema,
  createCampaignSchema,
  topupBillingSchema,
  withdrawBillingSchema,
} from './schemas.js';
import { verifyPayment, settlePayment } from '../x402/facilitator.js';
import { buildReceiptHeader } from '../x402/receipt.js';
import { verifyImpressionProof } from './verify.js';
import { logger } from '../lib/logger.js';
import { publicClient, walletClient, operatorAccount } from '../chain/operator.js';

export const marketersRouter = Router();

// Middleware to authorize marketer session
async function requireMarketer(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header is required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifySessionToken(token);
    req.marketerId = decoded.sub.toLowerCase();
    
    // Check if marketer exists, if not create
    let marketer = await Marketer.findById(req.marketerId);
    if (!marketer) {
      marketer = new Marketer({
        _id: req.marketerId,
        balanceUsdc: '0.000000',
      });
      await marketer.save();
    }
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

// SIWE Auth routes
marketersRouter.post('/v1/marketers/auth/nonce', (req, res) => {
  const parseResult = nonceSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.message });
    return;
  }
  // Generate random 8-character numeric nonce
  const nonce = Math.floor(10000000 + Math.random() * 90000000).toString();
  res.json({ nonce });
});

marketersRouter.post('/v1/marketers/auth/verify', async (req, res) => {
  const parseResult = verifySiweSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.message });
    return;
  }

  const { message, signature } = parseResult.data;
  try {
    const walletAddress = await verifySiweSignature(message, signature);
    const token = generateSessionToken(walletAddress);

    // Ensure Marketer exists in DB
    let marketer = await Marketer.findById(walletAddress);
    if (!marketer) {
      marketer = new Marketer({
        _id: walletAddress,
        balanceUsdc: '0.000000',
      });
      await marketer.save();
    }

    res.json({
      sessionJwt: token,
      walletAddress,
    });
  } catch (error) {
    logger.error(`SIWE login failed: ${(error as Error).message}`);
    res.status(401).json({ error: (error as Error).message });
  }
});

// Profile route
marketersRouter.get('/v1/marketers/me', requireMarketer, async (req: any, res) => {
  const marketer = await Marketer.findById(req.marketerId);
  res.json(marketer);
});

// Stats route
marketersRouter.get('/v1/marketers/stats', requireMarketer, async (req: any, res) => {
  const campaigns = await Campaign.find({ marketerId: req.marketerId });
  const campaignIds = campaigns.map((c) => c._id.toString());

  const totalCampaigns = campaigns.length;
  const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;

  // Total impressions
  const impressions = await Impression.find({ campaignId: { $in: campaignIds } });
  const totalImpressions = impressions.length;

  // Average watch duration
  let avgWatchMs = 0;
  if (totalImpressions > 0) {
    const sum = impressions.reduce((acc, imp) => acc + imp.watchedMs, 0);
    avgWatchMs = Math.round(sum / totalImpressions);
  }

  // Total spent
  const totalSpent = campaigns.reduce((acc, c) => acc + parseFloat(c.spentUsdc), 0);

  res.json({
    totalSpendUsdc: totalSpent.toFixed(6),
    totalImpressions,
    avgWatchPercent: totalImpressions > 0 ? 98 : 0, // mock CTR / watch pct
    activeCampaigns,
  });
});

// Campaigns routes
marketersRouter.post('/v1/marketers/campaigns', requireMarketer, async (req: any, res) => {
  const parseResult = createCampaignSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.message });
    return;
  }

  const marketer = await Marketer.findById(req.marketerId);
  if (!marketer) {
    res.status(404).json({ error: 'Marketer not found' });
    return;
  }

  // Check budget vs marketer balance
  const budget = parseFloat(parseResult.data.budgetUsdc);
  const balance = parseFloat(marketer.balanceUsdc);

  if (budget > balance) {
    res.status(400).json({ error: `Insufficient balance. Campaign budget: ${budget} USDC, Current balance: ${balance} USDC.` });
    return;
  }

  // Deduct from marketer balance
  marketer.balanceUsdc = (balance - budget).toFixed(6);
  await marketer.save();

  const campaign = new Campaign({
    marketerId: req.marketerId,
    mp4Url: parseResult.data.mp4Url,
    durationMs: parseResult.data.durationMs,
    ctaUrl: parseResult.data.ctaUrl,
    bidPerViewUsdc: parseResult.data.bidPerViewUsdc,
    budgetUsdc: parseResult.data.budgetUsdc,
    spentUsdc: '0.000000',
    status: 'active',
    frequencyCap: parseResult.data.frequencyCap,
  });

  await campaign.save();
  res.json(campaign);
});

marketersRouter.get('/v1/marketers/campaigns', requireMarketer, async (req: any, res) => {
  const campaigns = await Campaign.find({ marketerId: req.marketerId }).sort({ createdAt: -1 });
  res.json(campaigns);
});

marketersRouter.get('/v1/marketers/campaigns/:id', requireMarketer, async (req: any, res) => {
  const campaign = await Campaign.findOne({ _id: req.params.id, marketerId: req.marketerId });
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  res.json(campaign);
});

marketersRouter.get('/v1/marketers/campaigns/:id/impressions', requireMarketer, async (req: any, res) => {
  const campaign = await Campaign.findOne({ _id: req.params.id, marketerId: req.marketerId });
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  const impressions = await Impression.find({ campaignId: req.params.id }).sort({ completedAt: -1 }).limit(100);
  res.json(impressions);
});

// Billing routes
marketersRouter.post('/v1/marketers/billing/topup', requireMarketer, async (req: any, res) => {
  const parseResult = topupBillingSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.message });
    return;
  }

  const { amountUsdc } = parseResult.data;
  const usdcCostDecimals = Math.round(parseFloat(amountUsdc) * 1000000); // 6 decimals

  const xPaymentHeader = req.headers['x-payment'];
  if (!xPaymentHeader) {
    // Return standard HTTP 402 with billing configuration
    res.status(402).json({
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'avalanche-fuji',
          maxAmountRequired: usdcCostDecimals.toString(),
          resource: `${req.protocol}://${req.get('host')}/v1/marketers/billing/topup`,
          description: `Molfi Marketer Top-up — ${amountUsdc} USDC`,
          mimeType: 'application/json',
          payTo: operatorAccount.address,
          maxTimeoutSeconds: 60,
          asset: env.FUJI_USDC_ADDRESS,
          extra: { name: 'USD Coin', version: '2' },
        },
      ],
      error: 'X-PAYMENT header is required',
    });
    return;
  }

  try {
    const rawPayload = JSON.parse(Buffer.from(xPaymentHeader as string, 'base64').toString('utf-8'));
    const { payload } = rawPayload;

    await verifyPayment(payload, usdcCostDecimals.toString());
    const txHash = await settlePayment(payload);

    // Wait for inclusion block
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 30000 });
    if (receipt.status !== 'success') {
      res.status(402).json({ error: 'On-chain topup transaction reverted' });
      return;
    }

    // Add to marketer balance
    const marketer = await Marketer.findById(req.marketerId);
    if (marketer) {
      const currentBalance = parseFloat(marketer.balanceUsdc);
      marketer.balanceUsdc = (currentBalance + parseFloat(amountUsdc)).toFixed(6);
      await marketer.save();
    }

    const receiptHeader = buildReceiptHeader(txHash, payload.authorization.from);
    res.setHeader('X-PAYMENT-RESPONSE', receiptHeader);
    res.json({ success: true, txHash });
  } catch (error) {
    logger.error(`Marketer billing topup failed: ${(error as Error).message}`);
    res.status(402).json({ error: (error as Error).message });
  }
});

// Withdraw router (Operator transfers back to marketer)
marketersRouter.post('/v1/marketers/billing/withdraw', requireMarketer, async (req: any, res) => {
  const parseResult = withdrawBillingSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.message });
    return;
  }

  const { amountUsdc } = parseResult.data;
  const marketer = await Marketer.findById(req.marketerId);
  if (!marketer) {
    res.status(404).json({ error: 'Marketer not found' });
    return;
  }

  const balance = parseFloat(marketer.balanceUsdc);
  const withdrawAmount = parseFloat(amountUsdc);

  if (withdrawAmount > balance) {
    res.status(400).json({ error: 'Insufficient balance to withdraw' });
    return;
  }

  try {
    logger.info(`Sending withdrawal transaction of ${amountUsdc} USDC to ${req.marketerId}...`);
    // Direct token transfer via operator
    const usdcDecimals = BigInt(Math.round(withdrawAmount * 1000000));
    
    // Transfer function abi
    const transferAbi = [
      {
        name: 'transfer',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
      },
    ] as const;

    const txHash = await walletClient.writeContract({
      address: env.FUJI_USDC_ADDRESS as `0x${string}`,
      abi: transferAbi,
      functionName: 'transfer',
      args: [req.marketerId as `0x${string}`, usdcDecimals],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30000 });
    if (receipt.status !== 'success') {
      throw new Error('On-chain transfer transaction reverted');
    }

    // Deduct balance
    marketer.balanceUsdc = (balance - withdrawAmount).toFixed(6);
    await marketer.save();

    res.json({ success: true, txHash });
  } catch (error) {
    logger.error(`Withdrawal failed: ${(error as Error).message}`);
    res.status(400).json({ error: (error as Error).message });
  }
});

// PUBLIC verification route
marketersRouter.get('/v1/verify/impression/:id', async (req, res) => {
  try {
    const result = await verifyImpressionProof(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});
