import { Router } from "express";
import mongoose from "mongoose";
import { Campaign, AdImpression } from "../ads/models.js";
import { Campaign as LegacyCampaign, Impression as LegacyImpression } from "./models.js";
import { verifySessionToken } from "./auth.js";
import { gatewayUrl } from "../pinata/client.js";

export const campaignRouter = Router();

export function requireMarketerAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header is required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifySessionToken(token);
    req.marketer = { address: decoded.sub.toLowerCase() };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

campaignRouter.post("/v1/marketers/campaigns/metadata", requireMarketerAuth, async (req, res) => {
  const marketer = (req as any).marketer.address.toLowerCase();
  const { onchainId, title, description, ctaText, ctaUrl, targeting, thumbnailCid, durationMs, contentCid } = req.body;
  
  const existing = await Campaign.findOne({ onchainId });
  if (!existing) {
    return res.status(404).json({ error: "campaign not yet indexed; retry in 15s" });
  }
  if (existing.marketer !== marketer) {
    return res.status(403).json({ error: "not owner" });
  }

  existing.title = title;
  existing.description = description || "";
  existing.ctaText = ctaText || "Learn More";
  existing.ctaUrl  = ctaUrl;
  existing.targeting = targeting;
  existing.thumbnailCid = thumbnailCid;
  existing.durationMs = durationMs;
  existing.contentCid = contentCid;
  existing.contentURI = gatewayUrl(contentCid);
  
  await existing.save();
  res.json({ ok: true });
});

campaignRouter.get("/v1/marketers/campaigns", requireMarketerAuth, async (req, res) => {
  const marketer = (req as any).marketer.address.toLowerCase();
  const list = await Campaign.find({ marketer }).sort({ createdAt: -1 }).lean();
  res.json(list);
});

campaignRouter.get("/v1/marketers/analytics/timeseries", requireMarketerAuth, async (req, res) => {
  const marketer = (req as any).marketer.address.toLowerCase();
  
  const campaigns = await Campaign.find({ marketer }).select("onchainId");
  const campaignIds = campaigns.map(c => c.onchainId);

  if (!campaignIds.length) {
    return res.json([]);
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const data = await AdImpression.aggregate([
    {
      $match: {
        campaignId: { $in: campaignIds },
        status: { $in: ["CLAIMED", "ANCHORED"] },
        createdAt: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
        },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  const formatted = data.map(d => ({
    date: d._id,
    count: d.count
  }));

  res.json(formatted);
});

campaignRouter.get("/v1/marketers/campaigns/:id", requireMarketerAuth, async (req, res) => {
  const marketer = (req as any).marketer.address.toLowerCase();
  
  let query: any = { marketer };
  if (mongoose.Types.ObjectId.isValid(req.params.id)) {
    query.$or = [{ _id: req.params.id }, { onchainId: Number(req.params.id) || -1 }];
  } else {
    query.onchainId = Number(req.params.id) || -1;
  }
  
  const campaign = await Campaign.findOne(query);
  if (!campaign) {
    const legacyCampaign = await LegacyCampaign.findOne({ _id: req.params.id, marketerId: marketer });
    if (legacyCampaign) {
      return res.json(legacyCampaign);
    }
    return res.status(404).json({ error: "Campaign not found" });
  }
  
  const impressionsCount = await AdImpression.countDocuments({
    campaignId: campaign.onchainId,
    status: { $in: ["CLAIMED", "ANCHORED"] }
  });
  const spentUsdc = (impressionsCount * Number(campaign.rewardPerImpression) / 1e6).toFixed(6);

  const mapped = {
    _id: campaign._id,
    onchainId: campaign.onchainId,
    title: campaign.title,
    type: campaign.kind.toLowerCase(),
    creativeUrl: campaign.contentURI,
    bidPerViewUsdc: (Number(campaign.rewardPerImpression) / 1e6).toFixed(6),
    budgetUsdc: (Number(campaign.budgetRemaining) / 1e6).toFixed(6),
    spentUsdc,
    status: campaign.active ? "active" : "paused",
    ctaUrl: campaign.ctaUrl,
    targeting: campaign.targeting,
    createdAt: campaign.createdAt,
  };
  
  res.json(mapped);
});

campaignRouter.get("/v1/marketers/campaigns/:id/impressions", requireMarketerAuth, async (req, res) => {
  const marketer = (req as any).marketer.address.toLowerCase();
  
  let campaignQuery: any = { marketer };
  if (mongoose.Types.ObjectId.isValid(req.params.id)) {
    campaignQuery.$or = [{ _id: req.params.id }, { onchainId: Number(req.params.id) || -1 }];
  } else {
    campaignQuery.onchainId = Number(req.params.id) || -1;
  }
  
  const campaign = await Campaign.findOne(campaignQuery);
  if (!campaign) {
    const legacyCampaign = await LegacyCampaign.findOne({ _id: req.params.id, marketerId: marketer });
    if (legacyCampaign) {
      const impressions = await LegacyImpression.find({ campaignId: req.params.id }).sort({ completedAt: -1 }).limit(100).lean();
      return res.json(impressions);
    }
    return res.status(404).json({ error: "Campaign not found" });
  }

  const impressions = await AdImpression.find({ campaignId: campaign.onchainId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const mapped = impressions.map((imp: any) => ({
    _id: imp._id,
    viewerSessionHash: imp.viewer || "unknown",
    surface: imp.surface,
    type: campaign.kind.toLowerCase(),
    durationMs: imp.durationMs || 5000,
    startedAt: imp.startedAt,
    completedAt: imp.endedAt,
    status: imp.status.toLowerCase(),
    bidPaidUsdc: (Number(campaign.rewardPerImpression) / 1e6).toFixed(6),
    batchId: imp.status === "ANCHORED" ? 1 : undefined,
    settlementTxHash: imp.txHash,
  }));

  res.json(mapped);
});

campaignRouter.patch("/v1/marketers/campaigns/:id", requireMarketerAuth, async (req, res) => {
  const marketer = (req as any).marketer.address.toLowerCase();
  
  let query: any = { marketer };
  if (mongoose.Types.ObjectId.isValid(req.params.id)) {
    query.$or = [{ _id: req.params.id }, { onchainId: Number(req.params.id) || -1 }];
  } else {
    query.onchainId = Number(req.params.id) || -1;
  }

  const campaign = await Campaign.findOne(query);
  if (!campaign) {
    const legacyCampaign = await LegacyCampaign.findOne({ _id: req.params.id, marketerId: marketer });
    if (legacyCampaign) {
      const { status } = req.body;
      if (status !== "active" && status !== "paused") {
        return res.status(400).json({ error: "Invalid status" });
      }
      legacyCampaign.status = status;
      await legacyCampaign.save();
      return res.json(legacyCampaign);
    }
    return res.status(404).json({ error: "Campaign not found" });
  }

  const { status } = req.body;
  if (status === "active") {
    campaign.active = true;
  } else if (status === "paused") {
    campaign.active = false;
  } else {
    return res.status(400).json({ error: "Invalid status" });
  }

  await campaign.save();

  const impressionsCount = await AdImpression.countDocuments({
    campaignId: campaign.onchainId,
    status: { $in: ["CLAIMED", "ANCHORED"] }
  });
  const spentUsdc = (impressionsCount * Number(campaign.rewardPerImpression) / 1e6).toFixed(6);

  const mapped = {
    _id: campaign._id,
    onchainId: campaign.onchainId,
    title: campaign.title,
    type: campaign.kind.toLowerCase(),
    creativeUrl: campaign.contentURI,
    bidPerViewUsdc: (Number(campaign.rewardPerImpression) / 1e6).toFixed(6),
    budgetUsdc: (Number(campaign.budgetRemaining) / 1e6).toFixed(6),
    spentUsdc,
    status: campaign.active ? "active" : "paused",
    ctaUrl: campaign.ctaUrl,
    targeting: campaign.targeting,
    createdAt: campaign.createdAt,
  };

  res.json(mapped);
});
