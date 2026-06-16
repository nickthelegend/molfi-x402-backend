import { z } from 'zod';

export const slotRequestSchema = z.object({
  slotId: z.string(),
  session: z.string(),
  surface: z.enum(['frontend', 'extension']),
  modelHint: z.string().optional(),
});

export const heartbeatInputSchema = z.object({
  impressionToken: z.string(),
  seq: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  visibility: z.enum(['visible', 'hidden']),
  evidence: z.record(z.any()),
});

export const claimInputSchema = z.object({
  impressionToken: z.string(),
  watchedMs: z.number().nonnegative(),
  lastSeq: z.number().int(),
  completionSig: z.string().optional(),
  hp: z.string().optional(), // Honeypot field - bots fill this, humans leave it empty
});

export type SlotRequestInput = z.infer<typeof slotRequestSchema>;
export type HeartbeatInput = z.infer<typeof heartbeatInputSchema>;
export type ClaimInput = z.infer<typeof claimInputSchema>;
