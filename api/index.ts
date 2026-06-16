import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { logger } from '../src/lib/logger.js';

// Connect MongoDB on cold start
import mongoose from 'mongoose';

let isConnected = false;

async function ensureConnection() {
  if (!isConnected) {
    try {
      await mongoose.connect(env.MONGODB_URI);
      isConnected = true;
      logger.info('Connected to MongoDB (serverless)');
    } catch (err: any) {
      logger.error(`MongoDB connection error: ${err.message}`);
    }
  }
}

// Wrap the Express app for Vercel
export default async function handler(req: any, res: any) {
  await ensureConnection();
  return app(req, res);
}
