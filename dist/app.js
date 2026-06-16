"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const env_js_1 = require("./env.js");
const health_js_1 = require("./routes/health.js");
exports.app = (0, express_1.default)();
exports.app.use((0, cors_1.default)({
    origin: env_js_1.env.CORS_ORIGINS,
    exposedHeaders: ['X-PAYMENT-RESPONSE'],
}));
exports.app.use(express_1.default.json());
// Routes
exports.app.use(health_js_1.healthRouter);
