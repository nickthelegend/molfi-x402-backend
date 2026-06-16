import { logger } from '../lib/logger.js';
import { Impression, AdHeartbeat } from '../marketers/models.js';
import type { ClaimInput } from './schemas.js';

export class VerificationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

export async function verifyClaim(input: ClaimInput): Promise<any> {
  // 0. Honeypot check: bots fill this, humans leave it empty
  if (input.hp) {
    throw new VerificationError('HONEYPOT', 'Bot activity detected (honeypot triggered)');
  }

  // 1. Look up impression by impressionToken
  const impression = await Impression.findOne({ token: input.impressionToken });
  if (!impression) {
    throw new VerificationError('TOKEN_UNKNOWN', 'Unknown impression token');
  }
  if (impression.status === 'claimed') {
    throw new VerificationError('ALREADY_CLAIMED', 'Token already used');
  }
  if (impression.status === 'rejected') {
    throw new VerificationError('REJECTED', 'Previously rejected');
  }

  const heartbeats = await AdHeartbeat
    .find({ impressionId: impression._id })
    .sort({ seq: 1 })
    .lean();

  // 2. Heartbeats arrived. There must be at least floor(duration/700) of them.
  const minHeartbeats = Math.floor(impression.durationMs / 700);
  if (heartbeats.length < minHeartbeats) {
    throw new VerificationError(
      'SPARSE_HEARTBEATS',
      `Need ≥ ${minHeartbeats} heartbeats, got ${heartbeats.length}`
    );
  }

  // 3. Seq must be monotonic and dense. No gap > 1500ms in arrival times.
  let prevArrival = impression.startedAt.getTime();
  for (let i = 0; i < heartbeats.length; i++) {
    const hb = heartbeats[i];
    if (hb.seq !== i) {
      throw new VerificationError('SEQ_GAP', `seq mismatch at ${i}: got ${hb.seq}`);
    }
    const arrival = hb.serverReceivedAt.getTime();
    if (arrival - prevArrival > 1500) {
      throw new VerificationError(
        'ARRIVAL_GAP',
        `gap ${arrival - prevArrival}ms between hb ${i - 1} and ${i}`
      );
    }
    prevArrival = arrival;
  }

  // 4. Visibility — ≥ 95% of heartbeats must report 'visible' AND inside bounds.
  const visibleCount = heartbeats.filter(h => {
    const isVisible = h.visibility === 'visible';
    if (!isVisible) return false;

    if (impression.type === 'video') {
      return !h.evidence.videoPaused;
    } else {
      // image ad checks
      return h.evidence.cursorInside || h.evidence.scrollIntoView;
    }
  }).length;

  const visibilityRatio = visibleCount / heartbeats.length;
  if (visibilityRatio < 0.95) {
    throw new VerificationError(
      'LOW_VISIBILITY',
      `visibility ${(visibilityRatio * 100).toFixed(1)}% < 95%`
    );
  }

  // 5. Wall-clock sanity. Server-observed elapsed must match client-claimed within 2000ms.
  const serverElapsed = prevArrival - impression.startedAt.getTime();
  if (Math.abs(serverElapsed - input.watchedMs) > 2000) {
    throw new VerificationError(
      'CLOCK_DRIFT',
      `client said ${input.watchedMs}ms, server saw ${serverElapsed}ms`
    );
  }

  // 6. For video: last heartbeat's videoCurrentTimeMs must be within 1000ms of durationMs.
  if (impression.type === 'video') {
    const last = heartbeats[heartbeats.length - 1];
    const lastTime = last.evidence?.videoCurrentTimeMs || 0;
    if (impression.durationMs - lastTime > 1000) {
      throw new VerificationError(
        'NOT_COMPLETED',
        `video stopped at ${lastTime}/${impression.durationMs}ms`
      );
    }
  }

  // 7. Frequency cap. Same viewerSessionHash + campaignId must not have a claim in last 4h on same surface.
  const recent = await Impression.findOne({
    viewerSessionHash: impression.viewerSessionHash,
    campaignId: impression.campaignId,
    status: 'claimed',
    surface: impression.surface,
    completedAt: { $gt: new Date(Date.now() - 4 * 3600_000) }
  });
  if (recent) {
    throw new VerificationError('FREQUENCY_CAP', 'Already viewed this campaign in last 4h');
  }

  logger.info({ impressionId: impression._id }, 'ad claim verified');
  return impression;
}
