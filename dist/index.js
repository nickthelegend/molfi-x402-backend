"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_js_1 = require("./app.js");
const env_js_1 = require("./env.js");
const verify_fuji_js_1 = require("./chain/verify-fuji.js");
const logger_js_1 = require("./lib/logger.js");
async function bootstrap() {
    logger_js_1.logger.info('Starting MOLFI.FUN Backend...');
    const fuji = await (0, verify_fuji_js_1.verifyFuji)();
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
  \x1b[1mFacilitator URL:\x1b[0m     ${env_js_1.env.X402_FACILITATOR_URL}
  \x1b[1mOpenRouter Key:\x1b[0m      ${env_js_1.env.OPENROUTER_API_KEY ? '✅ Present' : '❌ Missing'}
  \x1b[1mPort:\x1b[0m               ${env_js_1.env.PORT}
\x1b[31m============================================================\x1b[0m
`);
    if (!fuji.success) {
        logger_js_1.logger.error(`Fuji connection error: ${fuji.error}`);
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
    app_js_1.app.listen(env_js_1.env.PORT, () => {
        logger_js_1.logger.info(`Molfi Backend is listening on port ${env_js_1.env.PORT}`);
    });
}
bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
});
