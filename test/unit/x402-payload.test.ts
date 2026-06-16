import { describe, it, expect } from 'vitest';
import { xPaymentZodSchema } from '../../src/x402/middleware.js';

describe('x402-payload.test.ts - x402 Payload Schema Validation', () => {
  it('should parse and accept a valid x402 payment header payload', () => {
    const validPayload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'avalanche-fuji',
      payload: {
        signature: '0x' + 'a'.repeat(130),
        authorization: {
          from: '0x' + 'b'.repeat(40),
          to: '0x' + 'c'.repeat(40),
          value: '1000',
          validAfter: 0,
          validBefore: 1780000000,
          nonce: '0x' + 'd'.repeat(64),
        },
      },
    };

    const parsed = xPaymentZodSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
  });

  it('should reject invalid version, scheme or network', () => {
    const basePayload = {
      x402Version: 2, // invalid
      scheme: 'exact',
      network: 'avalanche-fuji',
      payload: {
        signature: '0x' + 'a'.repeat(130),
        authorization: {
          from: '0x' + 'b'.repeat(40),
          to: '0x' + 'c'.repeat(40),
          value: '1000',
          validAfter: 0,
          validBefore: 1780000000,
          nonce: '0x' + 'd'.repeat(64),
        },
      },
    };

    let parsed = xPaymentZodSchema.safeParse(basePayload);
    expect(parsed.success).toBe(false);

    const basePayload2 = { ...basePayload, x402Version: 1, scheme: 'range' }; // invalid scheme
    parsed = xPaymentZodSchema.safeParse(basePayload2);
    expect(parsed.success).toBe(false);

    const basePayload3 = { ...basePayload, x402Version: 1, scheme: 'exact', network: 'mainnet' }; // invalid network
    parsed = xPaymentZodSchema.safeParse(basePayload3);
    expect(parsed.success).toBe(false);
  });

  it('should validate signature format', () => {
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'avalanche-fuji',
      payload: {
        signature: '0xabc', // too short
        authorization: {
          from: '0x' + 'b'.repeat(40),
          to: '0x' + 'c'.repeat(40),
          value: '1000',
          validAfter: 0,
          validBefore: 1780000000,
          nonce: '0x' + 'd'.repeat(64),
        },
      },
    };

    const parsed = xPaymentZodSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('should validate addresses, values and nonces', () => {
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'avalanche-fuji',
      payload: {
        signature: '0x' + 'a'.repeat(130),
        authorization: {
          from: 'invalid-address',
          to: '0x' + 'c'.repeat(40),
          value: 'not-a-number',
          validAfter: -1, // negative
          validBefore: 1780000000,
          nonce: '0xabc', // invalid nonce
        },
      },
    };

    const parsed = xPaymentZodSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});
