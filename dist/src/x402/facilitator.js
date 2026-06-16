import { hexToBytes, slice } from 'viem';
import { operatorAccount, walletClient } from '../chain/operator.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
const usdcEip3009Abi = [
    {
        name: 'transferWithAuthorization',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
            { name: 'v', type: 'uint8' },
            { name: 'r', type: 'bytes32' },
            { name: 's', type: 'bytes32' },
        ],
        outputs: [],
    },
];
export async function verifyPayment(payload, expectedValue) {
    const { authorization } = payload;
    if (authorization.to.toLowerCase() !== operatorAccount.address.toLowerCase()) {
        throw new Error(`Invalid recipient: expected operator ${operatorAccount.address}, got ${authorization.to}`);
    }
    if (BigInt(authorization.value) < BigInt(expectedValue)) {
        throw new Error(`Insufficient payment amount: expected ${expectedValue}, got ${authorization.value}`);
    }
    const now = Math.floor(Date.now() / 1000);
    if (authorization.validBefore < now) {
        throw new Error(`Payment signature has expired: validBefore ${authorization.validBefore} < now ${now}`);
    }
    return true;
}
export async function settlePayment(payload) {
    const { authorization, signature } = payload;
    const sig = signature.startsWith('0x') ? signature : `0x${signature}`;
    if (sig.length !== 132) {
        throw new Error(`Invalid signature length: expected 130 characters + 0x prefix, got ${sig.length}`);
    }
    // First try remote facilitator URL
    if (env.X402_FACILITATOR_URL && env.X402_FACILITATOR_URL !== 'https://x402.org/facilitator') {
        try {
            logger.info(`Attempting remote x402 facilitator settlement at ${env.X402_FACILITATOR_URL}...`);
            const response = await fetch(`${env.X402_FACILITATOR_URL}/settle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    signature,
                    authorization,
                    network: 'avalanche-fuji',
                    asset: env.FUJI_USDC_ADDRESS,
                }),
            });
            if (response.ok) {
                const json = await response.json();
                const hash = json.txHash || json.transaction;
                if (hash) {
                    logger.info(`Payment settled via remote facilitator. Tx: ${hash}`);
                    return hash;
                }
            }
            logger.warn(`Remote facilitator returned status ${response.status}. Falling back to direct operator settlement.`);
        }
        catch (err) {
            logger.warn(`Remote facilitator request failed: ${err.message}. Falling back to direct operator settlement.`);
        }
    }
    // Fallback to local direct operator broadcast
    const r = slice(sig, 0, 32);
    const s = slice(sig, 32, 64);
    const signatureBytes = hexToBytes(sig);
    let v = signatureBytes[64];
    if (v < 27)
        v += 27;
    logger.info(`Broadcasting EIP-3009 payment on-chain from ${authorization.from} to operator...`);
    try {
        const txHash = await walletClient.writeContract({
            address: env.FUJI_USDC_ADDRESS,
            abi: usdcEip3009Abi,
            functionName: 'transferWithAuthorization',
            args: [
                authorization.from,
                authorization.to,
                BigInt(authorization.value),
                BigInt(authorization.validAfter),
                BigInt(authorization.validBefore),
                authorization.nonce,
                v,
                r,
                s,
            ],
        });
        logger.info(`Payment settled directly. Tx hash: ${txHash}`);
        return txHash;
    }
    catch (error) {
        logger.error(error, 'Failed to submit EIP-3009 on-chain transaction');
        throw new Error(`Blockchain settlement failed: ${error.message}`);
    }
}
