import { parseEther, parseUnits } from 'viem';
import { publicClient, walletClient, operatorAccount } from '../src/chain/operator.js';
import { env } from '../src/env.js';

const recipient = '0x8392443807F6F39F2C8E4b7E1aB3a2E0033d498a';

const erc20Abi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

async function main() {
  console.log(`🏦 TRANSFERRING FUNDS TO TEST CLIENT: ${recipient}...`);

  // 1. Transfer AVAX (Gas)
  console.log('Sending 0.05 AVAX...');
  const avaxHash = await walletClient.sendTransaction({
    to: recipient,
    value: parseEther('0.05'),
  });
  console.log(`AVAX TX Hash: ${avaxHash}`);
  await publicClient.waitForTransactionReceipt({ hash: avaxHash });
  console.log('AVAX Transfer confirmed.');

  // 2. Transfer USDC (Tokens)
  console.log('Sending 3 USDC...');
  const usdcHash = await walletClient.writeContract({
    address: env.FUJI_USDC_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, parseUnits('3', 6)],
  });
  console.log(`USDC TX Hash: ${usdcHash}`);
  await publicClient.waitForTransactionReceipt({ hash: usdcHash });
  console.log('USDC Transfer confirmed.');

  console.log('🎉 Test client wallet funded successfully!');
}

main().catch((err) => {
  console.error('Funding failed:', err);
  process.exit(1);
});
