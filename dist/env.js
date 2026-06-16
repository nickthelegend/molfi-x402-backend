"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    PORT: zod_1.z.coerce.number().default(8787),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
    FUJI_RPC_URL: zod_1.z.string().url('FUJI_RPC_URL must be a valid URL'),
    FUJI_USDC_ADDRESS: zod_1.z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'FUJI_USDC_ADDRESS must be a valid Ethereum address'),
    BACKEND_OPERATOR_PRIVATE_KEY: zod_1.z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'BACKEND_OPERATOR_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x'),
    X402_FACILITATOR_URL: zod_1.z.string().url('X402_FACILITATOR_URL must be a valid URL'),
    OPENROUTER_API_KEY: zod_1.z.string().min(1, 'OPENROUTER_API_KEY must not be empty'),
    OPENROUTER_BASE_URL: zod_1.z.string().url().default('https://openrouter.ai/api/v1'),
    OPENROUTER_REFERER: zod_1.z.string().url().default('https://molfi.fun'),
    OPENROUTER_TITLE: zod_1.z.string().default('Molfi.fun'),
    CORS_ORIGINS: zod_1.z.string().transform((val) => val.split(',').map((s) => s.trim())),
});
let validatedEnv;
try {
    validatedEnv = envSchema.parse(process.env);
}
catch (error) {
    if (error instanceof zod_1.z.ZodError) {
        console.error('❌ Invalid environment configuration:');
        error.errors.forEach((err) => {
            console.error(`  - ${err.path.join('.')}: ${err.message}`);
        });
    }
    else {
        console.error('❌ Environment validation failed:', error);
    }
    process.exit(1);
}
exports.env = validatedEnv;
