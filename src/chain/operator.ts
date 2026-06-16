import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from '../env.js';
import { avalancheFuji } from './fuji.js';

if (!env.BACKEND_OPERATOR_PRIVATE_KEY.startsWith('0x')) {
  throw new Error('BACKEND_OPERATOR_PRIVATE_KEY must start with 0x');
}

export const operatorAccount = privateKeyToAccount(env.BACKEND_OPERATOR_PRIVATE_KEY as `0x${string}`);

export const publicClient = createPublicClient({
  chain: avalancheFuji,
  transport: http(env.FUJI_RPC_URL),
});

export const walletClient = createWalletClient({
  account: operatorAccount,
  chain: avalancheFuji,
  transport: http(env.FUJI_RPC_URL),
});
