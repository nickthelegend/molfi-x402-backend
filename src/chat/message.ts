import mongoose, { Schema } from 'mongoose';

export interface IChatMessage {
  userAddress?: string;
  payer?: string;
  paidVia: 'x402' | 'credits';
  txHash?: string;
  model: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt?: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
  userAddress: { type: String, default: '' },
  payer: { type: String, default: '' },
  paidVia: { type: String, enum: ['x402', 'credits'], required: true },
  txHash: { type: String, default: '' },
  model: { type: String, required: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true }
  }]
}, { timestamps: { createdAt: true, updatedAt: false } });

export const ChatMessage = mongoose.models.ChatMessage || mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema);
