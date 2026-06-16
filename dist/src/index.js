import { app } from './app.js';
import { env } from './env.js';
import { verifyFuji } from './chain/verify-fuji.js';
import { logger } from './lib/logger.js';
import { startIndexer } from './ads/indexer.js';
import { startAnchorWorker } from './ads/anchor.js';
async function bootstrap() {
    logger.info('Starting MOLFI.FUN Backend...');
    const fuji = await verifyFuji();
    let avaxWarning = false;
    let usdcWarning = false;
    if (fuji.success) {
        if (parseFloat(fuji.avaxBalance || '0') < 0.05)
            avaxWarning = true;
        if (parseFloat(fuji.usdcBalance || '0') < 1.0)
            usdcWarning = true;
    }
    // Print Banner
    console.log(`
\x1b[31m============================================================
  🏔️  MOLFI.FUN — AVALANCHE AGENTIC PAYMENTS API BOOTED
============================================================\x1b[0m
  \x1b[1mChain:\x1b[0m               Avalanche Fuji (43113)
  \x1b[1mOperator Address:\x1b[0m    ${fuji.success ? fuji.operatorAddress : '\x1b[31mFAILED TO CONNECT\x1b[0m'}
  \x1b[1mBalances:\x1b[0m            ${fuji.success
        ? `${fuji.avaxBalance} AVAX · ${fuji.usdcBalance} USDC`
        : '\x1b[31mN/A\x1b[0m'}
  \x1b[1mFacilitator URL:\x1b[0m     ${env.X402_FACILITATOR_URL}
  \x1b[1mOpenRouter Key:\x1b[0m      ${env.OPENROUTER_API_KEY ? '✅ Present' : '❌ Missing'}
  \x1b[1mPort:\x1b[0m               ${env.PORT}
\x1b[31m============================================================\x1b[0m
`);
    if (!fuji.success) {
        logger.error(`Fuji connection error: ${fuji.error}`);
    }
    if (avaxWarning || usdcWarning) {
        console.log(`
\x1b[33m⚠️  WARNING: LOW OPERATOR BALANCE\x1b[0m
  - AVAX (Gas): ${fuji.success ? fuji.avaxBalance : '0'} / 0.05 AVAX (min)
  - USDC:       ${fuji.success ? fuji.usdcBalance : '0'} / 1.00 USDC (min)

  Please top up the Operator wallet using the faucets:
  - AVAX Faucet: https://faucet.avax.network/
  - Circle USDC Faucet: https://faucet.circle.com/
`);
    }
    // OpenRouter validation probe on boot
    async function validateOpenRouter() {
        if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY.includes('<') || env.OPENROUTER_API_KEY === 'mock-key') {
            throw new Error('OPENROUTER_API_KEY is not configured or is a mock key');
        }
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
            headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`OpenRouter auth failed on boot: ${res.status} — ${body}`);
        }
        const data = (await res.json());
        console.log(`[openrouter] OK — credit: $${data.data?.usage ?? 0} / $${data.data?.limit ?? '∞'}`);
    }
    if (env.NODE_ENV === 'production') {
        await validateOpenRouter();
    }
    else {
        validateOpenRouter().catch((err) => {
            logger.warn(`[openrouter] Validation failed: ${err.message}`);
        });
    }
    app.listen(env.PORT, () => {
        logger.info(`Molfi Backend is listening on port ${env.PORT}`);
    });
    // Start new ad economy indexer and anchor worker
    startIndexer();
    startAnchorWorker();
    // Run legacy Merkle batcher every 60 seconds
    setInterval(() => {
        maybeAnchorBatch().catch((err) => {
            logger.error(`Failed to anchor Merkle batch in cron: ${err.message}`);
        });
    }, 60_000);
}
import { maybeAnchorBatch } from './marketers/settlement.js';
bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
});
