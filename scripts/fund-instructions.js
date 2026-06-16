"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_js_1 = require("../src/env.js");
const operator_js_1 = require("../src/chain/operator.js");
function main() {
    console.log('🟥  MOLFI.FUN FUNDING INSTRUCTIONS');
    console.log('==================================');
    console.log(`Operator Address: ${operator_js_1.operatorAccount.address}`);
    console.log(`USDC Contract:    ${env_js_1.env.FUJI_USDC_ADDRESS}`);
    console.log('\nFaucets to Top Up:');
    console.log('1. Fuji AVAX (Gas):');
    console.log('   https://faucet.avax.network/');
    console.log('   (Enter the operator address above to receive AVAX)');
    console.log('2. Circle Fuji USDC (Token):');
    console.log('   https://faucet.circle.com/');
    console.log('   (Select "Avalanche Fuji" and enter the operator address above)');
    console.log('==================================\n');
}
main();
