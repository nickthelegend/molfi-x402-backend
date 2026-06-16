import { verifyFuji } from '../src/chain/verify-fuji.js';

async function run() {
  console.log('🔍 Connecting to Avalanche Fuji...');
  const result = await verifyFuji();
  if (result.success) {
    console.log('✅ Fuji Network Connection Successful!');
    console.log(`Chain ID:         ${result.chainId}`);
    console.log(`Latest Block:     ${result.latestBlock}`);
    console.log(`Operator Address: ${result.operatorAddress}`);
    console.log(`AVAX Balance:     ${result.avaxBalance} AVAX`);
    console.log(`USDC Balance:     ${result.usdcBalance} USDC`);
  } else {
    console.error('❌ Fuji Connection Failed!');
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

run();
