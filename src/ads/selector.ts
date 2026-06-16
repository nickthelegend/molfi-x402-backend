import { Campaign } from "./models.js";

export type SelectorOpts = {
  viewer: string;
  surface: "chat-web" | "extension";
  kind: "text" | "image" | "video";
  modelInUse?: string;
};

export async function selectNextAd(opts: SelectorOpts) {
  const now = new Date();
  const KIND = opts.kind.toUpperCase();

  // Find all potentially active campaigns matching basic time and budget criteria
  const candidates = await Campaign.find({
    active: true,
    kind: KIND,
    startTime: { $lte: now },
    endTime: { $gte: now },
    $expr: { $gte: [{ $toLong: "$budgetRemaining" }, { $toLong: "$rewardPerImpression" }] },
  }).lean();

  if (!candidates.length) return null;

  // Filter based on surface and model targeting
  const eligible = candidates.filter((c: any) => {
    // Surface targeting
    const surfaces = c.targeting?.surfaces ?? [];
    if (surfaces.length && !surfaces.includes(opts.surface)) {
      return false;
    }

    // Model targeting
    const models = c.targeting?.models ?? [];
    if (models.length && opts.modelInUse && !models.includes(opts.modelInUse)) {
      return false;
    }

    return true;
  });

  if (!eligible.length) return null;

  // Weighted random selection based on rewardPerImpression
  const weighted = eligible.map((c: any) => ({
    c,
    w: Number(c.rewardPerImpression || 0)
  }));

  const total = weighted.reduce((sum: number, item: any) => sum + item.w, 0);
  if (total <= 0) return eligible[0]; // fallback

  let r = Math.random() * total;
  for (const { c, w } of weighted) {
    r -= w;
    if (r <= 0) return c;
  }

  return weighted[0].c;
}
