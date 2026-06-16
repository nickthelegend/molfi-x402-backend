import { Router } from 'express';
import { x402Middleware } from '../x402/middleware.js';
import { buildReceiptHeader } from '../x402/receipt.js';
import { sseInit, sseWrite, sseEnd } from '../lib/sse.js';
import { MODELS_REGISTRY } from './models.js';
import { streamOpenRouter } from './openrouter.js';
import { logger } from '../lib/logger.js';

export const chatRouter = Router();

chatRouter.post('/v1/chat/completions', x402Middleware, async (req, res) => {
  const { model, messages } = req.body;
  const modelConfig = MODELS_REGISTRY[model];

  try {
    if (req.payment && req.payment.paidVia === 'x402') {
      const receipt = buildReceiptHeader(req.payment.txHash, req.payment.payer);
      res.setHeader('X-PAYMENT-RESPONSE', receipt);
    }

    sseInit(res);

    await streamOpenRouter(modelConfig.openRouterId, messages, res);

    const metadata = {
      paidVia: req.payment?.paidVia || 'x402',
      txHash: req.payment?.txHash || '',
      payer: req.payment?.payer || '',
      model: model,
    };
    sseWrite(res, { molfiMetadata: metadata });

    sseEnd(res);
  } catch (error) {
    logger.error(`Error in /v1/chat/completions route: ${(error as Error).message}`);
    sseWrite(res, { error: (error as Error).message });
    res.end();
  }
});
