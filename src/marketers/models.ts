import mongoose from 'mongoose';

// Marketer Schema
export interface IMarketer {
  _id: string; // Lowercase Wallet Address
  email?: string;
  name?: string;
  balanceUsdc: string; // stored as string of decimal USDC (e.g. "10.000000")
  createdAt: Date;
}

const marketerSchema = new mongoose.Schema<IMarketer>({
  _id: { type: String, required: true },
  email: { type: String },
  name: { type: String },
  balanceUsdc: { type: String, default: "0.000000" },
  createdAt: { type: Date, default: Date.now },
});

export const Marketer = mongoose.models.Marketer || mongoose.model<IMarketer>('Marketer', marketerSchema);

// Campaign Schema
export interface ICampaign {
  _id: mongoose.Types.ObjectId;
  marketerId: string;
  mp4Url: string;
  durationMs: number;
  ctaUrl: string;
  bidPerViewUsdc: string; // e.g. "0.050000"
  budgetUsdc: string;
  spentUsdc: string;
  status: 'active' | 'paused' | 'depleted';
  frequencyCap: number;
  createdAt: Date;
}

const campaignSchema = new mongoose.Schema<ICampaign>({
  marketerId: { type: String, required: true },
  mp4Url: { type: String, required: true },
  durationMs: { type: Number, required: true },
  ctaUrl: { type: String, required: true },
  bidPerViewUsdc: { type: String, required: true },
  budgetUsdc: { type: String, required: true },
  spentUsdc: { type: String, default: "0.000000" },
  status: { type: String, enum: ['active', 'paused', 'depleted'], default: 'active' },
  frequencyCap: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export const Campaign = mongoose.models.Campaign || mongoose.model<ICampaign>('Campaign', campaignSchema);

// Impression Schema
export interface IImpression {
  _id: string; // Unique Impression ID
  campaignId: string;
  viewerSessionHash: string;
  viewerWallet?: string;
  watchedMs: number;
  completedAt: Date;
  creditJwtId?: string;
  leafHash: string;
  batchId?: number;
  settlementTxHash?: string;
}

const impressionSchema = new mongoose.Schema<IImpression>({
  _id: { type: String, required: true },
  campaignId: { type: String, required: true },
  viewerSessionHash: { type: String, required: true },
  viewerWallet: { type: String },
  watchedMs: { type: Number, required: true },
  completedAt: { type: Date, default: Date.now },
  creditJwtId: { type: String },
  leafHash: { type: String, required: true },
  batchId: { type: Number },
  settlementTxHash: { type: String },
});

export const Impression = mongoose.models.Impression || mongoose.model<IImpression>('Impression', impressionSchema);

// MerkleBatch Schema
export interface IMerkleBatch {
  _id: number; // Batch ID on-chain
  root: string;
  impressionCount: number;
  totalPayoutUsdc: string;
  anchorTxHash: string;
  anchoredAt: Date;
}

const merkleBatchSchema = new mongoose.Schema<IMerkleBatch>({
  _id: { type: Number, required: true },
  root: { type: String, required: true },
  impressionCount: { type: Number, required: true },
  totalPayoutUsdc: { type: String, required: true },
  anchorTxHash: { type: String, required: true },
  anchoredAt: { type: Date, default: Date.now },
});

export const MerkleBatch = mongoose.models.MerkleBatch || mongoose.model<IMerkleBatch>('MerkleBatch', merkleBatchSchema);
