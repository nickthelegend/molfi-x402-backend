"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.avalancheFuji = void 0;
exports.avalancheFuji = {
    id: 43113,
    name: 'Avalanche Fuji',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://api.avax-test.network/ext/bc/C/rpc'] },
    },
    blockExplorers: {
        default: { name: 'SnowTrace', url: 'https://testnet.snowtrace.io' },
    },
    testnet: true,
};
