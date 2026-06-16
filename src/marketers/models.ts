import mongoose, { Schema } from 'mongoose';

// Marketer Schema
export interface IMarketer {
  _id: string; // Lowercase Wallet Address
  walletAddress: string; // unique, lowercased
  email?: string;
  name?: string;
  balanceUsdc: string; // stored as string of decimal USDC (e.g. "10.000000")
  totalSpentUsdc: string;
  status: 'active' | 'suspended';
  acceptedToSAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const marketerSchema = new Schema<IMarketer>({
  _id: { type: String, required: true },
  walletAddress: { type: String, required: true, unique: true, index: true },
  email: { type: String },
  name: { type: String },
  balanceUsdc: { type: String, default: "0.000000" },
  totalSpentUsdc: { type: String, default: "0.000000" },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  acceptedToSAt: { type: Date },
}, { timestamps: true });

export const Marketer = mongoose.models.Marketer || mongoose.model<IMarketer>('Marketer', marketerSchema);

// Campaign Schema
export interface ICampaign {
  _id: mongoose.Types.ObjectId;
  marketerId: string;
  title: string;
  type: 'video' | 'image';
  creativeUrl: string; // S3 or local /public/uploads/<id>.<ext>
  durationMs: number; // for video; for image = "minimum dwell ms"
  thumbnailUrl?: string;
  ctaUrl: string; // raw destination
  bidPerViewUsdc: string;
  budgetUsdc: string;
  spentUsdc: string;
  status: 'pending_review' | 'active' | 'paused' | 'depleted' | 'rejected';
  rejectionReason?: string;
  targeting: {
    surfaces: ('frontend' | 'extension')[];
    modelHints?: string[];
  };
  frequencyCapPerSessionPer4h: number;
  postbackUrl?: string;
  isTest?: boolean;
  reviewedBy?: string; // admin wallet
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema = new Schema<ICampaign>({
  marketerId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  type: { type: String, enum: ['video', 'image'], required: true },
  creativeUrl: { type: String, required: true },
  durationMs: { type: Number, required: true },
  thumbnailUrl: { type: String },
  ctaUrl: { type: String, required: true },
  bidPerViewUsdc: { type: String, required: true },
  budgetUsdc: { type: String, required: true },
  spentUsdc: { type: String, default: "0.000000" },
  status: {
    type: String,
    enum: ['pending_review', 'active', 'paused', 'depleted', 'rejected'],
    default: 'pending_review'
  },
  rejectionReason: { type: String },
  targeting: {
    surfaces: [{ type: String, enum: ['frontend', 'extension'] }],
    modelHints: [{ type: String }]
  },
  frequencyCapPerSessionPer4h: { type: Number, default: 1 },
  postbackUrl: { type: String },
  isTest: { type: Boolean, default: false },
  reviewedBy: { type: String },
  reviewedAt: { type: Date }
}, { timestamps: true });

campaignSchema.index({ marketerId: 1, status: 1 });

export const Campaign = mongoose.models.Campaign || mongoose.model<ICampaign>('Campaign', campaignSchema);

// Impression Schema
export interface IImpression {
  _id: string; // Unique string ID
  token: string; // HMAC chain-anchor token
  campaignId: string;
  marketerId: string;
  viewerSessionHash: string; // sha256(sessionId + serverPepper)
  surface: 'frontend' | 'extension';
  type: 'video' | 'image';
  durationMs: number;
  startedAt: Date;
  completedAt?: Date;
  status: 'pending' | 'claimed' | 'rejected';
  rejectionCode?: string;
  leafHash?: string; // keccak256
  batchId?: number; // once anchored
  bidPaidUsdc: string;
}

const impressionSchema = new Schema<IImpression>({
  _id: { type: String, required: true },
  token: { type: String, required: true, unique: true, index: true },
  campaignId: { type: String, required: true, index: true },
  marketerId: { type: String, required: true },
  viewerSessionHash: { type: String, required: true },
  surface: { type: String, enum: ['frontend', 'extension'], required: true },
  type: { type: String, enum: ['video', 'image'], required: true },
  durationMs: { type: Number, required: true },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: { type: Date },
  status: { type: String, enum: ['pending', 'claimed', 'rejected'], default: 'pending' },
  rejectionCode: { type: String },
  leafHash: { type: String },
  batchId: { type: Number },
  bidPaidUsdc: { type: String, required: true }
});

impressionSchema.index({ viewerSessionHash: 1, campaignId: 1, completedAt: 1 });

export const Impression = mongoose.models.Impression || mongoose.model<IImpression>('Impression', impressionSchema);

// AdHeartbeat Schema
export interface IAdHeartbeat {
  _id: mongoose.Types.ObjectId;
  impressionId: string;
  seq: number;
  serverReceivedAt: Date;
  elapsedMs: number;
  visibility: 'visible' | 'hidden';
  evidence: Record<string, any>;
}

const adHeartbeatSchema = new Schema<IAdHeartbeat>({
  impressionId: { type: String, required: true },
  seq: { type: Number, required: true },
  serverReceivedAt: { type: Date, required: true, default: Date.now },
  elapsedMs: { type: Number, required: true },
  visibility: { type: String, enum: ['visible', 'hidden'], required: true },
  evidence: { type: Schema.Types.Mixed, required: true }
});

adHeartbeatSchema.index({ impressionId: 1, seq: 1 }, { unique: true });

export const AdHeartbeat = mongoose.models.AdHeartbeat || mongoose.model<IAdHeartbeat>('AdHeartbeat', adHeartbeatSchema);

// SpentCredit Schema
export interface ISpentCredit {
  jti: string;
  spentAt: Date;
  imp: string;
}

const spentCreditSchema = new Schema<ISpentCredit>({
  jti: { type: String, required: true, unique: true, index: true },
  spentAt: { type: Date, required: true },
  imp: { type: String, required: true }
});

spentCreditSchema.index({ spentAt: 1 }, { expireAfterSeconds: 86400 }); // TTL of 24 hours

export const SpentCredit = mongoose.models.SpentCredit || mongoose.model<ISpentCredit>('SpentCredit', spentCreditSchema);

// MerkleBatch Schema
export interface IMerkleBatch {
  _id: number; // Batch ID on-chain
  batchId: number;
  root: string;
  impressionCount: number;
  totalPayoutUsdc: string;
  anchorTxHash: string;
  anchoredAt: Date;
  fileUrl?: string;
}

const merkleBatchSchema = new Schema<IMerkleBatch>({
  _id: { type: Number, required: true },
  batchId: { type: Number, required: true },
  root: { type: String, required: true },
  impressionCount: { type: Number, required: true },
  totalPayoutUsdc: { type: String, required: true },
  anchorTxHash: { type: String, required: true },
  anchoredAt: { type: Date, required: true, default: Date.now },
  fileUrl: { type: String }
});

export const MerkleBatch = mongoose.models.MerkleBatch || mongoose.model<IMerkleBatch>('MerkleBatch', merkleBatchSchema);

// AdClick Schema
export interface IAdClick {
  _id: mongoose.Types.ObjectId;
  impressionId: string;
  clickedAt: Date;
  redirectedTo: string;
  viewerSessionHash: string;
  signedToken: string;
}

const adClickSchema = new Schema<IAdClick>({
  impressionId: { type: String, required: true },
  clickedAt: { type: Date, required: true, default: Date.now },
  redirectedTo: { type: String, required: true },
  viewerSessionHash: { type: String, required: true },
  signedToken: { type: String, required: true }
});

export const AdClick = mongoose.models.AdClick || mongoose.model<IAdClick>('AdClick', adClickSchema);
