import { z } from 'zod';

export const nonceSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid Ethereum address'),
});

export const verifySiweSchema = z.object({
  message: z.string().min(1, 'SIWE message is required'),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/i, 'Invalid signature format'),
});

export const updateProfileSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  name: z.string().min(2, 'Name must be at least 2 characters long').max(50, 'Name must be at most 50 characters long').optional(),
});
export const createCampaignSchema = z.object({
  title: z.string().min(3).max(80),
  type: z.enum(['video', 'image']),
  creativeUrl: z.string().url('Invalid creative URL').optional(), // Can be optional if uploaded via multipart
  durationMs: z.number().int().positive('Duration must be a positive integer'),
  ctaUrl: z.string().url().refine(u => !u.includes('javascript:'), 'No javascript URLs allowed'),
  bidPerViewUsdc: z.string().regex(/^\d+\.\d{1,6}$/, 'Bid must be a valid USDC amount (e.g. 0.050000)'),
  budgetUsdc: z.string().regex(/^\d+\.\d{1,6}$/, 'Budget must be a valid USDC amount (e.g. 100.000000)'),
  targeting: z.object({
    surfaces: z.array(z.enum(['frontend', 'extension'])).min(1, 'At least one surface must be targeted'),
    modelHints: z.array(z.string()).optional(),
  }),
  frequencyCapPerSessionPer4h: z.number().int().nonnegative().default(1),
  postbackUrl: z.string().url('Invalid postback URL').optional(),
  isTest: z.boolean().optional(),
});

export const topupBillingSchema = z.object({
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Amount must be valid decimal USDC'),
});

export const withdrawBillingSchema = z.object({
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Amount must be valid decimal USDC'),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid Ethereum address').optional(),
});

export const rejectCampaignSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required'),
});

export const suspendMarketerSchema = z.object({
  reason: z.string().min(1, 'Suspension reason is required'),
});
