import { Router } from 'express';
import { verifyFuji } from '../chain/verify-fuji.js';
import { env } from '../env.js';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  const result = await verifyFuji();
  if (result.success) {
    res.json({
      ok: true,
      chain: result.chainId,
      operator: result.operatorAddress,
      avaxBalance: result.avaxBalance,
      usdcBalance: result.usdcBalance,
      openrouter: !!env.OPENROUTER_API_KEY,
    });
  } else {
    res.status(500).json({
      ok: false,
      error: result.error,
      openrouter: !!env.OPENROUTER_API_KEY,
    });
  }
});
