"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRouter = void 0;
const express_1 = require("express");
const verify_fuji_js_1 = require("../chain/verify-fuji.js");
const env_js_1 = require("../env.js");
exports.healthRouter = (0, express_1.Router)();
exports.healthRouter.get('/health', async (req, res) => {
    const result = await (0, verify_fuji_js_1.verifyFuji)();
    if (result.success) {
        res.json({
            ok: true,
            chain: result.chainId,
            operator: result.operatorAddress,
            avaxBalance: result.avaxBalance,
            usdcBalance: result.usdcBalance,
            openrouter: !!env_js_1.env.OPENROUTER_API_KEY,
        });
    }
    else {
        res.status(500).json({
            ok: false,
            error: result.error,
            openrouter: !!env_js_1.env.OPENROUTER_API_KEY,
        });
    }
});
