"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletClient = exports.publicClient = exports.operatorAccount = void 0;
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const env_js_1 = require("../env.js");
const fuji_js_1 = require("./fuji.js");
if (!env_js_1.env.BACKEND_OPERATOR_PRIVATE_KEY.startsWith('0x')) {
    throw new Error('BACKEND_OPERATOR_PRIVATE_KEY must start with 0x');
}
exports.operatorAccount = (0, accounts_1.privateKeyToAccount)(env_js_1.env.BACKEND_OPERATOR_PRIVATE_KEY);
exports.publicClient = (0, viem_1.createPublicClient)({
    chain: fuji_js_1.avalancheFuji,
    transport: (0, viem_1.http)(env_js_1.env.FUJI_RPC_URL),
});
exports.walletClient = (0, viem_1.createWalletClient)({
    account: exports.operatorAccount,
    chain: fuji_js_1.avalancheFuji,
    transport: (0, viem_1.http)(env_js_1.env.FUJI_RPC_URL),
});
