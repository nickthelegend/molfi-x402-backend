import { createPublicClient, http, formatUnits } from 'viem';
import { avalancheFuji } from '../src/chain/fuji.js';
import { env } from '../src/env.js';

const publicClient = createPublicClient({
  chain: avalancheFuji,
  transport: http(env.FUJI_RPC_URL),
});

const USDC_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

async function checkBalance(name: string, address: string) {
  const avax = await publicClient.getBalance({ address: address as `0x${string}` });
  let usdc = 0n;
  try {
    usdc = (await publicClient.readContract({
      address: env.FUJI_USDC_ADDRESS as `0x${string}`,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })) as bigint;
  } catch (err: any) {
    console.error(`Failed to read USDC balance for ${address}:`, err.message);
  }

  console.log(`\n--- ${name} ---`);
  console.log(`Address: ${address}`);
  console.log(`AVAX:    ${formatUnits(avax, 18)} AVAX`);
  console.log(`USDC:    ${formatUnits(usdc, 6)} USDC`);
}

async function main() {
  const operatorAddress = '0x635ee3EE5D1bADA3c2EF9b3A4a6c741a8460AeBE';
  const testClientAddress = env.TEST_CLIENT_ADDRESS || '0x8392443807F6F39F2C8E4b7E1aB3a2E0033d498a';
  
  await checkBalance('Operator', operatorAddress);
  await checkBalance('Test Client', testClientAddress);
}

main().catch(console.error);
