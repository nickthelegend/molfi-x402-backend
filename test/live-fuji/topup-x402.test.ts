import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { Server } from 'http';
import mongoose from 'mongoose';
import { env } from '../../src/env.js';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, keccak256, stringToHex, formatUnits } from 'viem';
import { avalancheFuji } from '../../src/chain/fuji.js';
import { Marketer } from '../../src/marketers/models.js';
import { operatorAccount } from '../../src/chain/operator.js';

describe('topup-x402.test.ts - [live-fuji] Marketer billing topup via x402 USDC', () => {
  let server: Server;
  let port: number;
  const clientPrivateKey = process.env.TEST_CLIENT_PRIVATE_KEY;
  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(env.FUJI_RPC_URL),
  });

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(env.MONGODB_URI);
    }
    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 8787 : address?.port || 8787;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('should top up marketer balance using x402 EIP-3009 payment', async () => {
    if (!clientPrivateKey) {
      if (process.env.CI === 'true') {
        throw new Error('TEST_CLIENT_PRIVATE_KEY is required in CI mode');
      }
      console.warn('⚠️  TEST_CLIENT_PRIVATE_KEY not configured. Skipping marketer live Fuji topup test.');
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
      if (process.env.CI === 'true') {
        throw new Error('Test client wallet has 0 AVAX in CI mode');
      }
      console.warn('⚠️  Test client has 0 AVAX. Skipping live topup.');
      expect(true).toBe(true);
      return;
    }

    // Step 1: Perform SIWE Login to get JWT
    const nonceRes = await fetch(`http://localhost:${port}/v1/marketers/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: clientAccount.address }),
    });
    const { nonce: siweNonce } = (await nonceRes.json()) as { nonce: string };

    const message = `localhost wants you to sign in with your Ethereum account:
${clientAccount.address}

URI: http://localhost:3002
Version: 1
Chain ID: 43113
Nonce: ${siweNonce}
Issued At: ${new Date().toISOString()}`;

    const siweSignature = await clientAccount.signMessage({ message });

    const verifyRes = await fetch(`http://localhost:${port}/v1/marketers/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature: siweSignature }),
    });
    const { sessionJwt } = (await verifyRes.json()) as { sessionJwt: string };

    // Reset marketer balance in DB
    await Marketer.updateOne(
      { _id: clientAccount.address.toLowerCase() },
      { $set: { balanceUsdc: '0.000000', name: 'Live Tester Brand' } }
    );

    // Step 2: Build the x402 payment
    const amountUsdc = '1.00'; // 1.00 USDC
    const value = '1000000'; // 10^6 units
    const operatorAddress = operatorAccount.address;
    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + 120; // 2 minutes window
    const nonce = keccak256(stringToHex(`topup-${Date.now()}-${Math.random()}`));

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

    // Step 3: Trigger Top-up
    console.log(`Sending topup request for ${amountUsdc} USDC...`);
    const topupRes = await fetch(`http://localhost:${port}/v1/marketers/billing/topup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionJwt}`,
        'X-PAYMENT': xPaymentBase64,
      },
      body: JSON.stringify({ amountUsdc }),
    });

    expect(topupRes.status).toBe(200);
    const topupJson = (await topupRes.json()) as { success: boolean; txHash: string };
    expect(topupJson.success).toBe(true);
    expect(topupJson.txHash).toBeDefined();

    console.log(`Topup transaction confirmed: ${topupJson.txHash}`);

    // Verify database balance was updated
    const updatedMarketer = await Marketer.findById(clientAccount.address.toLowerCase());
    expect(parseFloat(updatedMarketer?.balanceUsdc || '0')).toBe(1.0);
  });
});
