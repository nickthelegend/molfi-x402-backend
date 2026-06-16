import { Router } from 'express';
import { verifyFuji } from '../chain/verify-fuji.js';
import { MODELS_REGISTRY } from '../chat/models.js';
import { publicClient } from '../chain/operator.js';
export const statusRouter = Router();
statusRouter.get('/v1/status', async (req, res) => {
    const result = await verifyFuji();
    let gasPrice = '0';
    try {
        const gasRaw = await publicClient.getGasPrice();
        gasPrice = gasRaw.toString();
    }
    catch (e) {
        // ignore
    }
    res.json({
        operatorAddress: result.success ? result.operatorAddress : null,
        usdcBalance: result.success ? result.usdcBalance : '0.00',
        avaxBalance: result.success ? result.avaxBalance : '0.00',
        chainId: 43113,
        gasPrice,
        models: MODELS_REGISTRY,
    });
});
statusRouter.get('/v1/models', (req, res) => {
    res.json(Object.values(MODELS_REGISTRY));
});
