import { Router } from 'express';
import mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../env.js';
import { Marketer, Campaign, Impression, MerkleBatch, AdClick } from './models.js';
import { generateSessionToken, verifySessionToken, verifySiweSignature } from './auth.js';
import {
  nonceSchema,
  verifySiweSchema,
  updateProfileSchema,
  createCampaignSchema,
  topupBillingSchema,
  withdrawBillingSchema,
  rejectCampaignSchema,
  suspendMarketerSchema
} from './schemas.js';
import { verifyPayment, settlePayment } from '../x402/facilitator.js';
import { buildReceiptHeader } from '../x402/receipt.js';
import { verifyImpressionProof } from './verify.js';
import { logger } from '../lib/logger.js';
import { publicClient, walletClient, operatorAccount } from '../chain/operator.js';

export const marketersRouter = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure public/uploads directory exists
const uploadsDir = path.resolve(__dirname, '../../../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware to authorize marketer session
export async function requireMarketer(req: any, res: any, next: any) {
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
        walletAddress: req.marketerId,
        balanceUsdc: '0.000000',
        totalSpentUsdc: '0.000000',
        status: 'active',
      });
      await marketer.save();
    }

    if (marketer.status === 'suspended') {
      return res.status(403).json({ error: 'Marketer account is suspended' });
    }
    
    req.marketer = marketer;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

// Admin wallet list from environment variables
const adminWallets = (process.env.ADMIN_WALLETS || '0x635ee3ee5d1bada3c2ef9b3a4a6c741a8460aebe')
  .split(',')
  .map(w => w.trim().toLowerCase())
  .filter(Boolean);

async function requireAdmin(req: any, res: any, next: any) {
  const marketerId = req.marketerId;
  if (!marketerId || !adminWallets.includes(marketerId.toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
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
    let marketer = await Marketer.findById(walletAddress.toLowerCase());
    if (!marketer) {
      marketer = new Marketer({
        _id: walletAddress.toLowerCase(),
        walletAddress: walletAddress.toLowerCase(),
        balanceUsdc: '0.000000',
        totalSpentUsdc: '0.000000',
        status: 'active',
      });
      await marketer.save();
    }

    res.json({
      sessionJwt: token,
      walletAddress: walletAddress.toLowerCase(),
    });
  } catch (error) {
    logger.error(`SIWE login failed: ${(error as Error).message}`);
    res.status(401).json({ error: (error as Error).message });
  }
});

// Profile routes
marketersRouter.get('/v1/marketers/me', requireMarketer, async (req: any, res) => {
  res.json(req.marketer);
});

marketersRouter.patch('/v1/marketers/me', requireMarketer, async (req: any, res) => {
  try {
    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.message });
    }

    const { email, name } = parseResult.data;
    const marketer = req.marketer;

    if (email !== undefined) marketer.email = email;
    if (name !== undefined) marketer.name = name;

    await marketer.save();
    res.json(marketer);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Onboarding ToS accept
marketersRouter.post('/v1/marketers/onboarding/accept-tos', requireMarketer, async (req: any, res) => {
  try {
    const marketer = req.marketer;
    marketer.acceptedToSAt = new Date();
    await marketer.save();
    res.json({ success: true, acceptedToSAt: marketer.acceptedToSAt });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Stats route
marketersRouter.get('/v1/marketers/stats', requireMarketer, async (req: any, res) => {
  const campaigns = await Campaign.find({ marketerId: req.marketerId });
  const campaignIds = campaigns.map((c) => c._id.toString());

  const totalCampaigns = campaigns.length;
  const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;

  const impressions = await Impression.find({ campaignId: { $in: campaignIds }, status: 'claimed' });
  const totalImpressions = impressions.length;

  let avgWatchMs = 0;
  if (totalImpressions > 0) {
    const sum = impressions.reduce((acc, imp) => acc + imp.durationMs, 0);
    avgWatchMs = Math.round(sum / totalImpressions);
  }

  const clicks = await AdClick.find({ impressionId: { $in: impressions.map(i => i._id) } });
  const totalClicks = clicks.length;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  const totalSpent = campaigns.reduce((acc, c) => acc + parseFloat(c.spentUsdc), 0);

  res.json({
    totalSpendUsdc: totalSpent.toFixed(6),
    totalImpressions,
    avgWatchPercent: totalImpressions > 0 ? 100 : 0,
    activeCampaigns,
    totalClicks,
    ctr: ctr.toFixed(2),
  });
});

// Campaigns routes
marketersRouter.post('/v1/marketers/campaigns', requireMarketer, async (req: any, res, next) => {
  try {
    const parseResult = createCampaignSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.message });
    }

    const marketer = req.marketer;

    // Check budget vs marketer balance
    const budget = parseFloat(parseResult.data.budgetUsdc);
    const balance = parseFloat(marketer.balanceUsdc);

    if (budget > balance) {
      return res.status(400).json({
        error: `Insufficient balance. Campaign budget: ${budget} USDC, Current balance: ${balance} USDC.`,
      });
    }

    // Process file upload if creativeData present
    let creativeUrl = parseResult.data.creativeUrl || '';
    if (req.body.creativeData) {
      const buffer = Buffer.from(req.body.creativeData, 'base64');
      // Limit size of uploaded file
      const sizeMB = buffer.length / (1024 * 1024);
      const isVideo = parseResult.data.type === 'video';
      if (isVideo && sizeMB > 5) {
        return res.status(400).json({ error: 'Video file size exceeds 5MB limit' });
      }
      if (!isVideo && sizeMB > 2) {
        return res.status(400).json({ error: 'Image file size exceeds 2MB limit' });
      }

      // Check magic byte signature to ensure basic safety
      const firstBytes = buffer.slice(0, 4).toString('hex');
      if (isVideo) {
        // mp4 check
        if (!firstBytes.includes('66747970')) { // ftyp
          return res.status(400).json({ error: 'Invalid file format: Expected MP4 container' });
        }
      } else {
        // png/jpg/webp
        const isPng = firstBytes.startsWith('89504e47');
        const isJpg = firstBytes.startsWith('ffd8ffe0') || firstBytes.startsWith('ffd8ffe1');
        const isWebp = firstBytes.startsWith('52494646'); // RIFF
        if (!isPng && !isJpg && !isWebp) {
          return res.status(400).json({ error: 'Invalid file format: Expected PNG, JPG, or WEBP image' });
        }
      }

      const ext = isVideo ? 'mp4' : (req.body.creativeExtension || 'png');
      const filename = `${new mongoose.Types.ObjectId().toString()}.${ext}`;
      const filepath = path.join(uploadsDir, filename);
      fs.writeFileSync(filepath, buffer);
      creativeUrl = `/uploads/${filename}`;
    }

    if (!creativeUrl) {
      return res.status(400).json({ error: 'Creative content file or URL is required' });
    }

    // Deduct budget upfront
    marketer.balanceUsdc = (balance - budget).toFixed(6);
    marketer.totalSpentUsdc = (parseFloat(marketer.totalSpentUsdc) + budget).toFixed(6);
    await marketer.save();

    const campaign = new Campaign({
      marketerId: req.marketerId,
      title: parseResult.data.title,
      type: parseResult.data.type,
      creativeUrl,
      durationMs: parseResult.data.durationMs,
      ctaUrl: parseResult.data.ctaUrl,
      bidPerViewUsdc: parseResult.data.bidPerViewUsdc,
      budgetUsdc: parseResult.data.budgetUsdc,
      spentUsdc: '0.000000',
      status: 'pending_review', // Requires admin approval
      targeting: parseResult.data.targeting,
      frequencyCapPerSessionPer4h: parseResult.data.frequencyCapPerSessionPer4h,
    });

    await campaign.save();
    logger.info({ campaignId: campaign._id, marketerId: req.marketerId }, 'campaign created');
    res.status(201).json(campaign);
  } catch (error) {
    next(error);
  }
});

marketersRouter.get('/v1/marketers/campaigns', requireMarketer, async (req: any, res) => {
  const campaigns = await Campaign.find({ marketerId: req.marketerId }).sort({ createdAt: -1 });
  res.json(campaigns);
});

marketersRouter.get('/v1/marketers/campaigns/:id', requireMarketer, async (req: any, res) => {
  const campaign = await Campaign.findOne({ _id: req.params.id, marketerId: req.marketerId });
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  res.json(campaign);
});

// Toggle status of campaign (pause/active)
marketersRouter.patch('/v1/marketers/campaigns/:id', requireMarketer, async (req: any, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, marketerId: req.marketerId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const { status } = req.body;
    if (status !== 'active' && status !== 'paused') {
      return res.status(400).json({ error: 'Invalid status toggle option' });
    }

    // If active, ensure budget is not depleted
    if (status === 'active' && parseFloat(campaign.spentUsdc) >= parseFloat(campaign.budgetUsdc)) {
      return res.status(400).json({ error: 'Campaign budget depleted' });
    }

    campaign.status = status;
    await campaign.save();
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

marketersRouter.get('/v1/marketers/campaigns/:id/impressions', requireMarketer, async (req: any, res) => {
  const campaign = await Campaign.findOne({ _id: req.params.id, marketerId: req.marketerId });
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const impressions = await Impression.find({ campaignId: req.params.id }).sort({ completedAt: -1 }).limit(100);
  res.json(impressions);
});

// Billing routes
marketersRouter.post('/v1/marketers/billing/topup-quote', requireMarketer, async (req: any, res) => {
  try {
    const parseResult = topupBillingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.message });
    }
    const { amountUsdc } = parseResult.data;
    const usdcCostDecimals = Math.round(parseFloat(amountUsdc) * 1000000);

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
      error: 'Payment required',
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

marketersRouter.post('/v1/marketers/billing/topup', requireMarketer, async (req: any, res) => {
  const parseResult = topupBillingSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.message });
    return;
  }

  const { amountUsdc } = parseResult.data;
  const usdcCostDecimals = Math.round(parseFloat(amountUsdc) * 1000000);

  const xPaymentHeader = req.headers['x-payment'];
  if (!xPaymentHeader) {
    res.status(402).json({ error: 'X-PAYMENT header is required' });
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

// Withdraw routes (Operator transfers back to marketer)
marketersRouter.post('/v1/marketers/billing/withdraw', requireMarketer, async (req: any, res) => {
  const parseResult = withdrawBillingSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.message });
    return;
  }

  const { amountUsdc, toAddress } = parseResult.data;
  const targetAddress = toAddress || req.marketerId;

  const marketer = await Marketer.findById(req.marketerId);
  if (!marketer) {
    res.status(404).json({ error: 'Marketer not found' });
    return;
  }

  const balance = parseFloat(marketer.balanceUsdc);
  const withdrawAmount = parseFloat(amountUsdc);

  // Cooldown limit (1h between withdrawals)
  const lastWithdrawKey = `last_withdraw_${req.marketerId}`;
  const now = Date.now();
  const lastWithdraw = (global as any)[lastWithdrawKey] || 0;
  if (now - lastWithdraw < 3600 * 1000) {
    return res.status(429).json({ error: 'Withdrawal is on a 1-hour cooldown. Please wait.' });
  }

  // Minimum balance gas reserve: 0.1 USDC
  if (balance - withdrawAmount < 0.1) {
    res.status(400).json({ error: 'Withdrawal requires leaving a minimum of 0.1 USDC balance for batch anchors.' });
    return;
  }

  if (withdrawAmount > balance) {
    res.status(400).json({ error: 'Insufficient balance to withdraw' });
    return;
  }

  try {
    logger.info(`Sending withdrawal transaction of ${amountUsdc} USDC to ${targetAddress}...`);
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
      args: [targetAddress as `0x${string}`, usdcDecimals],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30000 });
    if (receipt.status !== 'success') {
      throw new Error('On-chain transfer transaction reverted');
    }

    // Deduct balance
    marketer.balanceUsdc = (balance - withdrawAmount).toFixed(6);
    await marketer.save();

    // Track cooldown
    (global as any)[lastWithdrawKey] = now;

    res.json({ success: true, txHash });
  } catch (error) {
    logger.error(`Withdrawal failed: ${(error as Error).message}`);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Ledger ledger transactions history
marketersRouter.get('/v1/marketers/billing/ledger', requireMarketer, async (req: any, res) => {
  try {
    const batches = await MerkleBatch.find().sort({ anchoredAt: -1 }).lean();
    
    const records = batches.map(b => {
      const sharePayout = parseFloat(b.totalPayoutUsdc) / 5; // proportional estimate
      return {
        id: b.batchId,
        type: 'settlement_anchor',
        amountUsdc: sharePayout.toFixed(6),
        timestamp: b.anchoredAt,
        txHash: b.anchorTxHash,
        explorerUrl: `${env.FUJI_EXPLORER_BASE}/tx/${b.anchorTxHash}`
      };
    });

    res.json({ ledger: records });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// PUBLIC verification route
marketersRouter.get('/v1/verify/impression/:id', async (req, res) => {
  try {
    res.setHeader('X-Robots-Tag', 'noindex');
    const result = await verifyImpressionProof(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

// ADMIN ROUTES (Guarded by requireMarketer + requireAdmin)
marketersRouter.get('/v1/admin/campaigns/queue', requireMarketer, requireAdmin, async (req: any, res) => {
  try {
    res.setHeader('X-Robots-Tag', 'noindex');
    const queue = await Campaign.find({ status: 'pending_review' }).sort({ createdAt: -1 });
    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

marketersRouter.post('/v1/admin/campaigns/:id/approve', requireMarketer, requireAdmin, async (req: any, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    campaign.status = 'active';
    campaign.reviewedBy = req.marketerId;
    campaign.reviewedAt = new Date();
    await campaign.save();
    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

marketersRouter.post('/v1/admin/campaigns/:id/reject', requireMarketer, requireAdmin, async (req: any, res) => {
  try {
    const parseResult = rejectCampaignSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.message });
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Refund campaign budget to marketer
    const marketer = await Marketer.findById(campaign.marketerId);
    if (marketer) {
      const budget = parseFloat(campaign.budgetUsdc);
      marketer.balanceUsdc = (parseFloat(marketer.balanceUsdc) + budget).toFixed(6);
      marketer.totalSpentUsdc = (parseFloat(marketer.totalSpentUsdc) - budget).toFixed(6);
      await marketer.save();
    }

    campaign.status = 'rejected';
    campaign.rejectionReason = parseResult.data.reason;
    campaign.reviewedBy = req.marketerId;
    campaign.reviewedAt = new Date();
    await campaign.save();

    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

marketersRouter.get('/v1/admin/marketers', requireMarketer, requireAdmin, async (req: any, res) => {
  try {
    const marketers = await Marketer.find().sort({ createdAt: -1 });
    res.json(marketers);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

marketersRouter.post('/v1/admin/marketers/:id/suspend', requireMarketer, requireAdmin, async (req: any, res) => {
  try {
    const parseResult = suspendMarketerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.message });
    }

    const marketer = await Marketer.findById(req.params.id.toLowerCase());
    if (!marketer) {
      return res.status(404).json({ error: 'Marketer not found' });
    }

    marketer.status = 'suspended';
    await marketer.save();

    // Auto-pause all active campaigns
    await Campaign.updateMany({ marketerId: marketer._id, status: 'active' }, { status: 'paused' });

    res.json({ success: true, marketer });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

marketersRouter.get('/v1/admin/stats', requireMarketer, requireAdmin, async (req: any, res) => {
  try {
    const totalImpressions = await Impression.countDocuments({ status: 'claimed' });
    const totalMarketers = await Marketer.countDocuments();
    const totalCampaigns = await Campaign.countDocuments();

    res.json({
      totalImpressions,
      totalMarketers,
      totalCampaigns,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
