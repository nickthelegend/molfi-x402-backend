import { verifyMessage } from "viem";

const MIN_WATCH_RATIO       = 0.95;
const MAX_HEARTBEAT_GAP_MS  = 2500;
const MIN_VISIBLE_RATIO     = 0.95;
const MIN_FOCUSED_RATIO     = 0.90;
const MAX_PAUSE_FRACTION    = 0.10;
const MIN_DISTINCT_SECONDS  = 3;

export type SafetyResult = {
  ok: boolean;
  score: number;
  reasons: string[];
};

export async function verifyImpression(imp: any): Promise<SafetyResult> {
  const reasons: string[] = [];
  const { heartbeats, durationMs, watchedMs, viewer, sessionId, nonceHex } = imp;

  if (!heartbeats || heartbeats.length < 3) {
    return { ok: false, score: 0, reasons: ["too few heartbeats"] };
  }

  // 1. Watch ratio check (only check if campaign kind is VIDEO, or general check on watchedMs)
  // For safety, we check if durationMs is provided
  const ratio = (watchedMs ?? 0) / Math.max(durationMs ?? 1, 1);
  if (ratio < MIN_WATCH_RATIO) {
    reasons.push(`watched ${ratio.toFixed(2)} < ${MIN_WATCH_RATIO}`);
  }

  // 2. Gap continuity check
  for (let i = 1; i < heartbeats.length; i++) {
    const gap = heartbeats[i].t - heartbeats[i - 1].t;
    if (gap > MAX_HEARTBEAT_GAP_MS) {
      reasons.push(`hb gap ${gap}ms exceeded limit of ${MAX_HEARTBEAT_GAP_MS}ms`);
      break;
    }
    if (gap < 0) {
      reasons.push("hb time went backward");
      break;
    }
  }

  // 3. Visibility / focus check
  const visibleCount = heartbeats.filter((h: any) => h.visible).length;
  const focusedCount = heartbeats.filter((h: any) => h.focused).length;
  if (visibleCount / heartbeats.length < MIN_VISIBLE_RATIO) {
    reasons.push(`tab/webview not visible enough: ${(visibleCount / heartbeats.length).toFixed(2)} < ${MIN_VISIBLE_RATIO}`);
  }
  if (focusedCount / heartbeats.length < MIN_FOCUSED_RATIO) {
    reasons.push(`window not focused enough: ${(focusedCount / heartbeats.length).toFixed(2)} < ${MIN_FOCUSED_RATIO}`);
  }

  // 4. Pause fraction check
  const pauseCount = heartbeats.filter((h: any) => h.paused).length;
  if (pauseCount / heartbeats.length > MAX_PAUSE_FRACTION) {
    reasons.push(`paused too often: ${(pauseCount / heartbeats.length).toFixed(2)} > ${MAX_PAUSE_FRACTION}`);
  }

  // 5. Progression — distinct integer seconds of currentTime
  const distinctSec = new Set(heartbeats.map((h: any) => Math.floor(h.currentTime || 0))).size;
  if (distinctSec < MIN_DISTINCT_SECONDS) {
    reasons.push(`video did not progress enough: distinct seconds ${distinctSec} < ${MIN_DISTINCT_SECONDS}`);
  }

  // 6. Monotonic currentTime check
  let regressions = 0;
  for (let i = 1; i < heartbeats.length; i++) {
    if ((heartbeats[i].currentTime || 0) + 0.5 < (heartbeats[i - 1].currentTime || 0)) {
      regressions++;
    }
  }
  if (regressions > 1) {
    reasons.push(`currentTime regressed too many times: regressions ${regressions} > 1`);
  }

  // 7. Cryptographic anchors — first AND last heartbeat must be signed by the viewer wallet
  const first = heartbeats[0];
  const last  = heartbeats[heartbeats.length - 1];

  if (!first.sig || !last.sig) {
    reasons.push("missing signatures on heartbeats");
  } else {
    const okFirst = await verifyMessage({
      address: viewer as `0x${string}`,
      message: heartbeatMessage(sessionId, nonceHex, first),
      signature: first.sig,
    }).catch(() => false);

    const okLast = await verifyMessage({
      address: viewer as `0x${string}`,
      message: heartbeatMessage(sessionId, nonceHex, last),
      signature: last.sig,
    }).catch(() => false);

    if (!okFirst || !okLast) {
      reasons.push(`signature verification failed. First: ${okFirst}, Last: ${okLast}`);
    }
  }

  const score = Math.max(0, 1 - reasons.length * 0.2);
  return {
    ok: reasons.length === 0,
    score,
    reasons
  };
}

export function heartbeatMessage(sessionId: string, nonceHex: string, hb: any): string {
  return [
    "molfi:hb:v1", 
    sessionId, 
    nonceHex,
    String(hb.t),
    Number(hb.currentTime || 0).toFixed(3),
    hb.paused ? "1" : "0",
    hb.muted  ? "1" : "0",
    hb.visible ? "1" : "0",
    hb.focused ? "1" : "0",
  ].join("|");
}
