import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  MONGODB_URI: z.string().url('MONGODB_URI must be a valid URL'),
  FUJI_RPC_URL: z.string().url('FUJI_RPC_URL must be a valid URL'),
  FUJI_USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'FUJI_USDC_ADDRESS must be a valid Ethereum address'),
  BACKEND_OPERATOR_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'BACKEND_OPERATOR_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x'),
  X402_FACILITATOR_URL: z.string().url('X402_FACILITATOR_URL must be a valid URL'),
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY must not be empty'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_REFERER: z.string().url().default('https://molfi.fun'),
  OPENROUTER_TITLE: z.string().default('Molfi.fun'),
  CORS_ORIGINS: z.string().transform((val) => val.split(',').map((s) => s.trim())),
});

let validatedEnv: z.infer<typeof envSchema>;

try {
  validatedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Invalid environment configuration:');
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  } else {
    console.error('❌ Environment validation failed:', error);
  }
  process.exit(1);
}

export const env = validatedEnv;
export type Env = z.infer<typeof envSchema>;
