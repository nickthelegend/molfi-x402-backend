import { z } from 'zod';

export const nonceSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid Ethereum address'),
});

export const verifySiweSchema = z.object({
  message: z.string().min(1, 'SIWE message is required'),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/i, 'Invalid signature format'),
});

export const createCampaignSchema = z.object({
  mp4Url: z.string().url('Invalid MP4 video URL'),
  durationMs: z.number().int().positive('Duration must be positive'),
  ctaUrl: z.string().url('Invalid Call-to-action (CTA) URL'),
  bidPerViewUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Bid must be a valid USDC amount (max 6 decimals)'),
  budgetUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Budget must be a valid USDC amount (max 6 decimals)'),
  frequencyCap: z.number().int().nonnegative('Frequency cap cannot be negative').default(0),
});

export const topupBillingSchema = z.object({
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Amount must be valid decimal USDC'),
});

export const withdrawBillingSchema = z.object({
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Amount must be valid decimal USDC'),
});
