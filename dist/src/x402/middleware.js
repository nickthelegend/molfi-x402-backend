import { z } from 'zod';
import { recoverTypedDataAddress } from 'viem';
import { MODELS_REGISTRY } from '../chat/models.js';
import { env } from '../env.js';
import { operatorAccount, publicClient } from '../chain/operator.js';
import { verifyPayment, settlePayment } from './facilitator.js';
import { logger } from '../lib/logger.js';
import { redeem } from '../credits/redeem.js';
import { verifyCreditToken } from '../credits/jwt.js';
import { getUserCredits, decrementUserCredits } from '../credits/store.js';
import { isNonceReplayed } from './nonce.js';
export const xPaymentZodSchema = z.object({
    x402Version: z.literal(1),
    scheme: z.literal('exact'),
    network: z.literal('avalanche-fuji'),
    payload: z.object({
        signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/, 'Invalid signature format'),
        authorization: z.object({
            from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid from address'),
            to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid to address'),
            value: z.string().regex(/^\d+$/, 'Invalid value amount'),
            validAfter: z.number().int().nonnegative(),
            validBefore: z.number().int().positive(),
            nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid 32-byte hex nonce'),
        }),
    }),
});
export async function x402Middleware(req, res, next) {
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
    const sendPaymentRequired = (errorMsg) => {
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
            if (decoded && decoded.jti) {
                // New Single-Use Credit JWT flow
                const claims = await redeem(token);
                req.payment = {
                    txHash: '',
                    payer: claims.sub,
                    paidVia: 'credits',
                };
                return next();
            }
            else {
                // Legacy user balance flow
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
            }
        }
        catch (err) {
            logger.warn(`Credit token verification/redemption failed: ${err.message}`);
            if (err.message === 'CREDIT_ALREADY_SPENT') {
                res.status(409).json({ error: 'credit already spent' });
                return;
            }
            sendPaymentRequired('Invalid or expired credit token.');
            return;
        }
    }
    // 2. Check for x402 Payment (Agent Rail)
    const xPaymentHeader = req.headers['x-payment'];
    if (!xPaymentHeader) {
        sendPaymentRequired('X-PAYMENT header is required');
        return;
    }
    try {
        let rawPayload;
        try {
            rawPayload = JSON.parse(Buffer.from(xPaymentHeader, 'base64').toString('utf-8'));
        }
        catch (e) {
            res.status(400).json({ error: 'Malformed Base64 payload in X-PAYMENT header' });
            return;
        }
        // Zod Validation
        const parsedPayloadResult = xPaymentZodSchema.safeParse(rawPayload);
        if (!parsedPayloadResult.success) {
            res.status(400).json({
                error: `Invalid X-PAYMENT protocol payload: ${parsedPayloadResult.error.message}`,
            });
            return;
        }
        const { payload } = parsedPayloadResult.data;
        // Hardening checks
        if (payload.authorization.to.toLowerCase() !== operatorAccount.address.toLowerCase()) {
            res.status(400).json({ error: `recipient address mismatch: expected ${operatorAccount.address}` });
            return;
        }
        if (BigInt(payload.authorization.value) < BigInt(modelConfig.usdcCostDecimals)) {
            res.status(400).json({ error: `value mismatch: expected minimum ${modelConfig.usdcCostDecimals}` });
            return;
        }
        const now = Math.floor(Date.now() / 1000);
        if (payload.authorization.validBefore < now + 30) {
            res.status(400).json({ error: 'signature validBefore is too close to expiry or already expired' });
            return;
        }
        if (payload.authorization.validAfter > now) {
            res.status(400).json({ error: 'signature is not valid yet (validAfter in future)' });
            return;
        }
        // Replay attack protection
        const isReplayed = await isNonceReplayed(payload.authorization.from, payload.authorization.nonce);
        if (isReplayed) {
            res.status(400).json({ error: 'nonce already used' });
            return;
        }
        // Signature Recovery
        try {
            const recoveredAddress = await recoverTypedDataAddress({
                domain: {
                    name: 'USD Coin',
                    version: '2',
                    chainId: 43113,
                    verifyingContract: env.FUJI_USDC_ADDRESS,
                },
                types: {
                    TransferWithAuthorization: [
                        { name: 'from', type: 'address' },
                        { name: 'to', type: 'address' },
                        { name: 'value', type: 'uint256' },
                        { name: 'validAfter', type: 'uint256' },
                        { name: 'validBefore', type: 'uint256' },
                        { name: 'nonce', type: 'bytes32' },
                    ],
                },
                primaryType: 'TransferWithAuthorization',
                message: {
                    from: payload.authorization.from,
                    to: payload.authorization.to,
                    value: BigInt(payload.authorization.value),
                    validAfter: BigInt(payload.authorization.validAfter),
                    validBefore: BigInt(payload.authorization.validBefore),
                    nonce: payload.authorization.nonce,
                },
                signature: payload.signature,
            });
            if (recoveredAddress.toLowerCase() !== payload.authorization.from.toLowerCase()) {
                res.status(400).json({ error: 'signature recovery validation failed' });
                return;
            }
        }
        catch (e) {
            res.status(400).json({ error: `signature recovery failed: ${e.message}` });
            return;
        }
        // Verify operator address setup
        await verifyPayment(payload, modelConfig.usdcCostDecimals.toString());
        // Settle Payment
        const txHash = await settlePayment(payload);
        // Wait for inclusion block
        logger.info(`Waiting for block inclusion of tx: ${txHash}`);
        const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
            timeout: 30000,
        });
        if (receipt.status !== 'success') {
            res.status(402).json({ error: 'On-chain signature settlement transaction reverted' });
            return;
        }
        req.payment = {
            txHash,
            payer: payload.authorization.from,
            paidVia: 'x402',
        };
        next();
    }
    catch (error) {
        logger.error(`x402 payment validation failed: ${error.message}`);
        res.status(402).json({ error: `Payment settlement failed: ${error.message}` });
    }
}
