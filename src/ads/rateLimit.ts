import { ViewerCounter } from "./models.js";

const MAX_PER_HOUR = 12;

export async function checkAndIncrement(viewer: string): Promise<number> {
  // hourBucket is e.g. "2026-06-16T18"
  const hourBucket = new Date().toISOString().slice(0, 13);
  
  const doc = await ViewerCounter.findOneAndUpdate(
    { viewer: viewer.toLowerCase(), hourBucket },
    { $inc: { count: 1 } },
    { upsert: true, new: true }
  );

  if (doc.count > MAX_PER_HOUR) {
    throw new Error("rate_limited");
  }

  return doc.count;
}
