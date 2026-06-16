"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyFuji = verifyFuji;
const viem_1 = require("viem");
const env_js_1 = require("../env.js");
const operator_js_1 = require("./operator.js");
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
async function verifyFuji() {
    try {
        const chainId = await operator_js_1.publicClient.getChainId();
        if (chainId !== 43113) {
            throw new Error(`Chain ID mismatch. Expected 43113 (Fuji), got ${chainId}`);
        }
        const latestBlock = await operator_js_1.publicClient.getBlockNumber();
        const avaxBalanceRaw = await operator_js_1.publicClient.getBalance({ address: operator_js_1.operatorAccount.address });
        const avaxBalance = (0, viem_1.formatUnits)(avaxBalanceRaw, 18);
        let usdcBalance = '0.00';
        try {
            const usdcDecimals = await operator_js_1.publicClient.readContract({
                address: env_js_1.env.FUJI_USDC_ADDRESS,
                abi: erc20Abi,
                functionName: 'decimals',
            });
            const usdcBalanceRaw = await operator_js_1.publicClient.readContract({
                address: env_js_1.env.FUJI_USDC_ADDRESS,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [operator_js_1.operatorAccount.address],
            });
            usdcBalance = (0, viem_1.formatUnits)(usdcBalanceRaw, usdcDecimals);
        }
        catch (e) {
            console.warn(`⚠️  Failed to read USDC balance from contract ${env_js_1.env.FUJI_USDC_ADDRESS}: ${e.message}`);
        }
        return {
            success: true,
            chainId,
            latestBlock: latestBlock.toString(),
            operatorAddress: operator_js_1.operatorAccount.address,
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
