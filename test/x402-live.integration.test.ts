import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, keccak256, stringToHex, formatUnits } from 'viem';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { Server } from 'http';
import { avalancheFuji } from '../src/chain/fuji.js';

describe('x402 Live Fuji Integration Test', () => {
  let server: Server;
  let port: number;
  const clientPrivateKey = process.env.TEST_CLIENT_PRIVATE_KEY;
  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(env.FUJI_RPC_URL),
  });

  beforeAll(() => {
    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 8787 : address?.port || 8787;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. GET completions without payment returns HTTP 402', async () => {
    const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'test request' }],
      }),
    });

    expect(res.status).toBe(402);
    const json = (await res.json()) as {
      x402Version: number;
      accepts: Array<{
        scheme: string;
        network: string;
        maxAmountRequired: string;
        asset: string;
        payTo: string;
      }>;
      error: string;
    };

    expect(json.x402Version).toBe(1);
    expect(json.accepts[0].scheme).toBe('exact');
    expect(json.accepts[0].network).toBe('avalanche-fuji');
    expect(json.accepts[0].maxAmountRequired).toBe('1000'); // Llama 3.3 70b is 0.001 USDC -> 1000 units
    expect(json.accepts[0].asset.toLowerCase()).toBe(env.FUJI_USDC_ADDRESS.toLowerCase());
    expect(json.error).toBe('X-PAYMENT header is required');
  });

  it('2. Live payment settlement via EIP-3009 signatures', async () => {
    if (!clientPrivateKey) {
      console.warn('⚠️  TEST_CLIENT_PRIVATE_KEY not configured. Skipping live Fuji EIP-3009 settlement test.');
      expect(true).toBe(true);
      return;
    }

    const clientAccount = privateKeyToAccount(clientPrivateKey as `0x${string}`);

    // Verify balance first to prevent test errors due to lack of funds
    const clientAvax = await publicClient.getBalance({ address: clientAccount.address });
    const clientAvaxFormatted = formatUnits(clientAvax, 18);
    console.log(`Test client address: ${clientAccount.address}`);
    console.log(`Test client AVAX:    ${clientAvaxFormatted} AVAX`);

    if (parseFloat(clientAvaxFormatted) === 0) {
      console.warn('⚠️  Test client has 0 AVAX. Skipping live settlement.');
      expect(true).toBe(true);
      return;
    }

    // Step A: Hit endpoint to retrieve token parameters (USDC address, operator destination)
    const unpaidRes = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const unpaidJson = (await unpaidRes.json()) as { accepts: Array<{ payTo: string; maxAmountRequired: string }> };
    const accepts = unpaidJson.accepts[0];

    const value = accepts.maxAmountRequired;
    const operatorAddress = accepts.payTo;
    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + 120; // 2 minutes window
    const nonce = keccak256(stringToHex(`nonce-${Date.now()}-${Math.random()}`));

    // Step B: Sign EIP-3009 transferWithAuthorization signature
    const signature = await clientAccount.signTypedData({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: 43113,
        verifyingContract: env.FUJI_USDC_ADDRESS as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: clientAccount.address,
        to: operatorAddress as `0x${string}`,
        value: BigInt(value),
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce: nonce,
      },
    });

    // Step C: Wrap payload in Base64 and build X-PAYMENT header
    const xPaymentPayload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'avalanche-fuji',
      payload: {
        signature,
        authorization: {
          from: clientAccount.address,
          to: operatorAddress,
          value,
          validAfter,
          validBefore,
          nonce,
        },
      },
    };

    const xPaymentBase64 = Buffer.from(JSON.stringify(xPaymentPayload)).toString('base64');

    // Step D: Submit paid request to completions endpoint
    const paidRes = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': xPaymentBase64,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'Say hello in 5 words.' }],
      }),
    });

    // Step E: Verify response headers and body status
    expect(paidRes.status).toBe(200);
    const receiptHeader = paidRes.headers.get('x-payment-response');
    expect(receiptHeader).toBeDefined();
    expect(receiptHeader).not.toBeNull();

    const decodedReceipt = JSON.parse(Buffer.from(receiptHeader as string, 'base64').toString('utf-8')) as {
      success: boolean;
      transaction: string;
      payer: string;
    };

    expect(decodedReceipt.success).toBe(true);
    expect(decodedReceipt.payer.toLowerCase()).toBe(clientAccount.address.toLowerCase());
    expect(decodedReceipt.transaction).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Step F: Wait for transaction on Fuji chain and assert logs
    console.log(`Waiting for transaction receipt on Fuji: ${decodedReceipt.transaction}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: decodedReceipt.transaction as `0x${string}`,
      timeout: 30000,
    });

    expect(receipt.status).toBe('success');
    expect(receipt.to?.toLowerCase()).toBe(env.FUJI_USDC_ADDRESS.toLowerCase());

    // Step G: Read SSE stream output and check formatting
    if (!paidRes.body) throw new Error('Response body is null');
    const reader = paidRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let outputText = '';
    let foundDone = false;

    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;

      const lines = decoder.decode(chunk).split('\n');
      for (const line of lines) {
        if (line.trim().startsWith('data: ')) {
          const raw = line.trim().slice(6);
          if (raw === '[DONE]') {
            foundDone = true;
          } else {
            try {
              const parsed = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> };
              if (parsed.choices?.[0]?.delta?.content) {
                outputText += parsed.choices[0].delta.content;
              }
            } catch (err) {
              // ignore parse errors for custom metadata blocks
            }
          }
        }
      }
    }

    console.log(`OpenRouter response content: "${outputText}"`);
    expect(outputText.length).toBeGreaterThan(0);
    expect(foundDone).toBe(true);
  });
});
