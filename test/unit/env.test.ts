import { describe, it, expect } from 'vitest';
import { envSchema } from '../../src/env.js';

describe('env.test.ts - Environment Zod Schema Validation', () => {
  it('should validate correct environment configurations', () => {
    const validConfig = {
      PORT: '8787',
      NODE_ENV: 'development',
      JWT_SECRET: 'change-me-32-bytes-min-jwt-secret-molfi',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/molfi',
      FUJI_RPC_URL: 'https://api.avax-test.network/ext/bc/C/rpc',
      FUJI_USDC_ADDRESS: '0x5425890298aed601595a70AB815c96711a31Bc65',
      BACKEND_OPERATOR_PRIVATE_KEY: '0x5626e9d8420ca50ebcfdee671648cb7c4bf772e29bf47aaa9ee53064a8e6310f',
      X402_FACILITATOR_URL: 'https://x402.org/facilitator',
      OPENROUTER_API_KEY: 'sk-or-v1-some-key-here',
      CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001',
    };

    const parsed = envSchema.safeParse(validConfig);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.PORT).toBe(8787);
      expect(parsed.data.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    }
  });

  it('should reject missing required keys', () => {
    const invalidConfig = {
      PORT: '8787',
    };

    const parsed = envSchema.safeParse(invalidConfig);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errorMap = parsed.error.flatten().fieldErrors;
      expect(errorMap.JWT_SECRET).toBeDefined();
      expect(errorMap.MONGODB_URI).toBeDefined();
      expect(errorMap.FUJI_USDC_ADDRESS).toBeDefined();
      expect(errorMap.BACKEND_OPERATOR_PRIVATE_KEY).toBeDefined();
    }
  });

  it('should enforce invalid types or formats', () => {
    const invalidConfig = {
      PORT: 'invalid-port',
      JWT_SECRET: 'short',
      MONGODB_URI: 'not-a-url',
      FUJI_USDC_ADDRESS: '0xInvalidAddress',
      BACKEND_OPERATOR_PRIVATE_KEY: '0xInvalidKey',
      X402_FACILITATOR_URL: 'not-a-url',
      OPENROUTER_API_KEY: '',
      CORS_ORIGINS: 'http://localhost:3000',
    };

    const parsed = envSchema.safeParse(invalidConfig);
    expect(parsed.success).toBe(false);
  });
});
