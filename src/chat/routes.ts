import { Router } from 'express';
import { x402Middleware } from '../x402/middleware.js';
import { buildReceiptHeader } from '../x402/receipt.js';
import { sseInit, sseWrite, sseEnd } from '../lib/sse.js';
import { MODELS_REGISTRY } from './models.js';
import { streamOpenRouter } from './openrouter.js';
import { ChatMessage } from './message.js';
import { logger } from '../lib/logger.js';
import { connectDb } from '../credits/store.js';

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

    const fullAssistantContent = await streamOpenRouter(modelConfig.openRouterId, messages, res);

    const metadata = {
      paidVia: req.payment?.paidVia || 'x402',
      txHash: req.payment?.txHash || '',
      payer: req.payment?.payer || '',
      model: model,
    };
    sseWrite(res, { molfiMetadata: metadata });

    sseEnd(res);

    // Save to MongoDB asynchronously after streaming is finished
    try {
      await connectDb();
      const dbMessages = [
        ...messages,
        { role: 'assistant', content: fullAssistantContent }
      ];
      await ChatMessage.create({
        userAddress: req.payment?.payer || '',
        payer: req.payment?.payer || '',
        paidVia: req.payment?.paidVia || 'x402',
        txHash: req.payment?.txHash || '',
        model: model,
        messages: dbMessages,
      });
      logger.info('Saved chat message to MongoDB');
    } catch (saveError) {
      logger.error(`Failed to save chat message to MongoDB: ${(saveError as Error).message}`);
    }
  } catch (error) {
    logger.error(`Error in /v1/chat/completions route: ${(error as Error).message}`);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'llm_upstream',
        detail: (error as Error).message,
        provider: 'openrouter',
      });
    } else {
      sseWrite(res, {
        error: 'llm_upstream',
        detail: (error as Error).message,
        provider: 'openrouter',
      });
      res.end();
    }
  }
});
