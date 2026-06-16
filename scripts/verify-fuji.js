"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const verify_fuji_js_1 = require("../src/chain/verify-fuji.js");
async function run() {
    console.log('🔍 Connecting to Avalanche Fuji...');
    const result = await (0, verify_fuji_js_1.verifyFuji)();
    if (result.success) {
        console.log('✅ Fuji Network Connection Successful!');
        console.log(`Chain ID:         ${result.chainId}`);
        console.log(`Latest Block:     ${result.latestBlock}`);
        console.log(`Operator Address: ${result.operatorAddress}`);
        console.log(`AVAX Balance:     ${result.avaxBalance} AVAX`);
        console.log(`USDC Balance:     ${result.usdcBalance} USDC`);
    }
    else {
        console.error('❌ Fuji Connection Failed!');
        console.error(`Error: ${result.error}`);
        process.exit(1);
    }
}
run();
