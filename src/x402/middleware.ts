import { Request, Response, NextFunction } from 'express';
import { MODELS_REGISTRY } from '../chat/models.js';
import { env } from '../env.js';
import { operatorAccount } from '../chain/operator.js';
import { verifyPayment, settlePayment } from './facilitator.js';
import { logger } from '../lib/logger.js';
import { getUserCredits, decrementUserCredits } from '../credits/store.js';
import { verifyCreditToken } from '../credits/jwt.js';

declare global {
  namespace Express {
    interface Request {
      payment?: {
        txHash: string;
        payer: string;
        paidVia: 'x402' | 'credits';
      };
    }
  }
}

export async function x402Middleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { model } = req.body;
  if (!model) {
    res.status(400).json({ error: 'model parameter is required' });
    return;
  }

  const modelConfig = MODELS_REGISTRY[model];
  if (!modelConfig) {
    res.status(400).json({ error: `Unsupported model: ${model}` });
    return;
  }

  // Helper to build 402 rejects schema
  const sendPaymentRequired = (errorMsg: string) => {
    res.status(402).json({
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'avalanche-fuji',
          maxAmountRequired: modelConfig.usdcCostDecimals.toString(),
          resource: `${req.protocol}://${req.get('host')}/v1/chat/completions`,
          description: `Molfi premium chat — ${modelConfig.name}, 1 message`,
          mimeType: 'text/event-stream',
          payTo: operatorAccount.address,
          maxTimeoutSeconds: 60,
          asset: env.FUJI_USDC_ADDRESS,
          extra: { name: 'USD Coin', version: '2' },
        },
      ],
      error: errorMsg,
    });
  };

  // 1. Check for Credit Authorization (Human Rail)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = verifyCreditToken(token);
      const userId = decoded.sub;

      const userCredits = await getUserCredits(userId);
      if (userCredits < modelConfig.creditCost) {
        logger.warn(`User ${userId} has insufficient credits: has ${userCredits}, needs ${modelConfig.creditCost}`);
        sendPaymentRequired('Insufficient credits. Watch ads or pay with USDC.');
        return;
      }

      const decremented = await decrementUserCredits(userId, modelConfig.creditCost);
      if (!decremented) {
        sendPaymentRequired('Failed to deduct credits. Please try again.');
        return;
      }

      req.payment = {
        txHash: '',
        payer: userId,
        paidVia: 'credits',
      };
      return next();
    } catch (err) {
      logger.warn(`Invalid or expired JWT token received: ${(err as Error).message}`);
    }
  }

  // 2. Check for x402 Payment (Agent Rail)
  const xPaymentHeader = req.headers['x-payment'];

  if (!xPaymentHeader) {
    sendPaymentRequired('X-PAYMENT header is required');
    return;
  }

  try {
    const decodedPayload = JSON.parse(
      Buffer.from(xPaymentHeader as string, 'base64').toString('utf-8')
    );

    if (
      decodedPayload.x402Version !== 1 ||
      decodedPayload.scheme !== 'exact' ||
      decodedPayload.network !== 'avalanche-fuji'
    ) {
      res.status(400).json({ error: 'Invalid X-PAYMENT protocol payload scheme or network' });
      return;
    }

    const { payload } = decodedPayload;
    if (!payload || !payload.signature || !payload.authorization) {
      res.status(400).json({ error: 'Malformed X-PAYMENT payload content' });
      return;
    }

    await verifyPayment(payload, modelConfig.usdcCostDecimals.toString());

    const txHash = await settlePayment(payload);

    req.payment = {
      txHash,
      payer: payload.authorization.from,
      paidVia: 'x402',
    };

    next();
  } catch (error) {
    logger.error(`x402 payment validation failed: ${(error as Error).message}`);
    res.status(402).json({ error: `Payment settlement failed: ${(error as Error).message}` });
  }
}
