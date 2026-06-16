import mongoose from 'mongoose';
import { connectDb } from '../credits/store.js';

interface IUsedNonce {
  from: string;
  nonce: string;
  createdAt: Date;
}

const usedNonceSchema = new mongoose.Schema<IUsedNonce>({
  from: { type: String, required: true },
  nonce: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 }, // TTL index to expire after 5 mins (matching sig duration)
});

// Composite index to ensure uniqueness of from + nonce
usedNonceSchema.index({ from: 1, nonce: 1 }, { unique: true });

export const UsedNonce = mongoose.models.UsedNonce || mongoose.model<IUsedNonce>('UsedNonce', usedNonceSchema);

export async function isNonceReplayed(from: string, nonce: string): Promise<boolean> {
  await connectDb();
  try {
    const fromLower = from.toLowerCase();
    const nonceLower = nonce.toLowerCase();
    // Try to insert
    await UsedNonce.create({
      from: fromLower,
      nonce: nonceLower,
    });
    return false; // Successful creation, means it's not a replay
  } catch (error) {
    // If unique key constraint error (11000), it's a replay!
    if ((error as any).code === 11000) {
      return true;
    }
    throw error;
  }
}
