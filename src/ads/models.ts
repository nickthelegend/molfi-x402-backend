import mongoose, { Schema, model } from "mongoose";

const CampaignSchema = new Schema({
  onchainId:    { type: Number, required: true, unique: true },
  marketer:     { type: String, required: true, index: true, lowercase: true },
  title:        { type: String, required: true },
  description:  String,
  contentCid:   { type: String, required: true },
  contentURI:   { type: String, required: true },
  thumbnailCid: String,
  kind:         { type: String, enum: ["TEXT","IMAGE","VIDEO"], required: true, index: true },
  budgetRemaining:     { type: String, required: true }, // bigint as string
  rewardPerImpression: { type: String, required: true },
  durationMs:   Number,
  ctaText:      String,
  ctaUrl:       String,
  startTime:    { type: Date, required: true, index: true },
  endTime:      { type: Date, required: true, index: true },
  active:       { type: Boolean, default: true, index: true },
  targeting: {
    models:    [String],
    surfaces:  [{ type: String, enum: ["chat-web","extension"] }],
    countries: [String],
  },
}, { timestamps: true });

const ImpressionSchema = new Schema({
  receiptId:  { type: String, required: true, unique: true },
  sessionId:  { type: String, required: true, unique: true },
  campaignId: { type: Number, required: true, index: true },
  viewer:     { type: String, required: true, index: true, lowercase: true },
  surface:    { type: String, enum: ["chat-web","extension"], required: true },
  nonceHex:   { type: String, required: true },
  startedAt:  { type: Date, required: true },
  endedAt:    Date,
  watchedMs:  Number,
  durationMs: Number,
  heartbeats: [{
    t: Number, currentTime: Number, paused: Boolean, muted: Boolean,
    visible: Boolean, focused: Boolean, sig: String,
  }],
  safetyScore: Number,
  status: { type: String, enum: ["PENDING","CLAIMED","REJECTED","ANCHORED"], default: "PENDING", index: true },
  rejectReason: String,
  txHash: String,
}, { timestamps: true });

const ViewerCounterSchema = new Schema({
  viewer:     { type: String, required: true, index: true, lowercase: true },
  hourBucket: { type: String, required: true },
  count:      { type: Number, default: 0 },
}, { timestamps: true });

ViewerCounterSchema.index({ viewer: 1, hourBucket: 1 }, { unique: true });

// Check if models exist already before compiling them (to support hot reload/re-imports)
export const Campaign      = mongoose.models.AdCampaign || model("AdCampaign", CampaignSchema);
export const AdImpression  = mongoose.models.AdImpression || model("AdImpression", ImpressionSchema);
export const ViewerCounter = mongoose.models.ViewerCounter || model("ViewerCounter", ViewerCounterSchema);
