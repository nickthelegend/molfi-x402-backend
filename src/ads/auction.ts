import { Campaign, Impression } from '../marketers/models.js';

export interface AuctionOpts {
  surface: 'frontend' | 'extension';
  viewerSessionHash: string;
  modelHint?: string;
}

export async function pickAd(opts: AuctionOpts): Promise<any> {
  // 1. Candidate set: active campaigns targeting this surface with budget remaining.
  const candidates = await Campaign.find({
    status: 'active',
    'targeting.surfaces': opts.surface,
    $expr: { $lt: [{ $toDecimal: '$spentUsdc' }, { $toDecimal: '$budgetUsdc' }] },
  }).lean();

  if (candidates.length === 0) return null;

  // 2. Filter out anything this viewer saw in last 4h (frequency cap).
  const recentClaims = await Impression.find({
    viewerSessionHash: opts.viewerSessionHash,
    status: 'claimed',
    completedAt: { $gt: new Date(Date.now() - 4 * 3600_000) }
  }, { campaignId: 1 }).lean();

  const seen = new Set(recentClaims.map(c => c.campaignId.toString()));
  const eligible = candidates.filter(c => !seen.has(c._id.toString()));
  if (eligible.length === 0) return null;

  // 3. Weighted selection by bid. Higher bid = higher probability, but never 100%
  //    (so newcomers always get some traffic — fairness floor 10%).
  const totalBid = eligible.reduce((s, c) => s + Number(c.bidPerViewUsdc), 0);
  if (totalBid === 0) {
    // If all bids are zero, pick uniformly
    const rIdx = Math.floor(Math.random() * eligible.length);
    return eligible[rIdx];
  }

  let r = Math.random();
  for (const c of eligible) {
    const w = 0.9 * (Number(c.bidPerViewUsdc) / totalBid) + 0.1 / eligible.length;
    if (r < w) return c;
    r -= w;
  }
  return eligible[eligible.length - 1];
}
