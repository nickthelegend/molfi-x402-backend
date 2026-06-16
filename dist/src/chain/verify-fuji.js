import { formatUnits } from 'viem';
import { env } from '../env.js';
import { operatorAccount, publicClient } from './operator.js';
const erc20Abi = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: 'balance', type: 'uint256' }],
    },
    {
        name: 'decimals',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: 'decimals', type: 'uint8' }],
    },
];
export async function verifyFuji() {
    try {
        const chainId = await publicClient.getChainId();
        if (chainId !== 43113) {
            throw new Error(`Chain ID mismatch. Expected 43113 (Fuji), got ${chainId}`);
        }
        const latestBlock = await publicClient.getBlockNumber();
        const avaxBalanceRaw = await publicClient.getBalance({ address: operatorAccount.address });
        const avaxBalance = formatUnits(avaxBalanceRaw, 18);
        let usdcBalance = '0.00';
        try {
            const usdcDecimals = await publicClient.readContract({
                address: env.FUJI_USDC_ADDRESS,
                abi: erc20Abi,
                functionName: 'decimals',
            });
            const usdcBalanceRaw = await publicClient.readContract({
                address: env.FUJI_USDC_ADDRESS,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [operatorAccount.address],
            });
            usdcBalance = formatUnits(usdcBalanceRaw, usdcDecimals);
        }
        catch (e) {
            console.warn(`⚠️  Failed to read USDC balance from contract ${env.FUJI_USDC_ADDRESS}: ${e.message}`);
        }
        return {
            success: true,
            chainId,
            latestBlock: latestBlock.toString(),
            operatorAddress: operatorAccount.address,
            avaxBalance,
            usdcBalance,
        };
    }
    catch (error) {
        return {
            success: false,
            error: error.message,
        };
    }
}
