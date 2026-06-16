import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { Server } from 'http';
import mongoose from 'mongoose';
import { env } from '../../src/env.js';
import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';
import { Marketer, Campaign, Impression } from '../../src/marketers/models.js';
import { ADS_REGISTRY } from '../../src/ads/registry.js';

describe('marketers-flow.integration.test.ts - Marketer SIWE, Campaign, and Impression flow', () => {
  let server: Server;
  let port: number;
  
  // Create a clean test wallet for SIWE login
  const testPrivKey = generatePrivateKey();
  const testAccount = privateKeyToAccount(testPrivKey);
  let sessionJwt = '';

  beforeAll(async () => {
    console.log('MARKETERS TEST: beforeAll started');
    console.log('MARKETERS TEST: readyState is', mongoose.connection.readyState);
    if (mongoose.connection.readyState !== 1) {
      if (mongoose.connection.readyState !== 0) {
        console.log('MARKETERS TEST: readyState not 0 or 1, disconnecting...');
        await mongoose.disconnect();
      }
      console.log('MARKETERS TEST: connecting to mongoose...');
      await mongoose.connect(env.MONGODB_URI);
      console.log('MARKETERS TEST: connected to mongoose');
    }
    // Clean up DB
    console.log('MARKETERS TEST: cleaning up DB...');
    await Marketer.deleteOne({ _id: testAccount.address.toLowerCase() });
    await Campaign.deleteMany({ marketerId: testAccount.address.toLowerCase() });
    console.log('MARKETERS TEST: DB cleaned up');

    return new Promise<void>((resolve) => {
      console.log('MARKETERS TEST: starting express server...');
      server = app.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 8787 : address?.port || 8787;
        console.log('MARKETERS TEST: express server listening on port', port);
        resolve();
      });
    });
  }, 30000);

  afterAll(async () => {
    console.log('MARKETERS TEST: afterAll started');
    await Marketer.deleteOne({ _id: testAccount.address.toLowerCase() });
    await Campaign.deleteMany({ marketerId: testAccount.address.toLowerCase() });
    console.log('MARKETERS TEST: closing server...');
    return new Promise<void>((resolve) => {
      if (server) {
        server.close(() => {
          console.log('MARKETERS TEST: server closed');
          resolve();
        });
        if (typeof (server as any).closeAllConnections === 'function') {
          (server as any).closeAllConnections();
        }
      } else {
        resolve();
      }
    });
  }, 30000);

  it('1. SIWE Authentication (Nonce -> Sign -> Verify)', async () => {
    // A. Get Nonce
    const nonceRes = await fetch(`http://localhost:${port}/v1/marketers/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: testAccount.address }),
    });
    expect(nonceRes.status).toBe(200);
    const { nonce } = (await nonceRes.json()) as { nonce: string };
    expect(nonce).toBeDefined();

    // B. Build SIWE message
    const message = `localhost wants you to sign in with your Ethereum account:
${testAccount.address}

URI: http://localhost:3002
Version: 1
Chain ID: 43113
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`;

    // C. Sign Message
    const signature = await testAccount.signMessage({ message });

    // D. Verify SIWE
    const verifyRes = await fetch(`http://localhost:${port}/v1/marketers/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    });

    expect(verifyRes.status).toBe(200);
    const verifyJson = (await verifyRes.json()) as { sessionJwt: string; walletAddress: string };
    expect(verifyJson.sessionJwt).toBeDefined();
    expect(verifyJson.walletAddress.toLowerCase()).toBe(testAccount.address.toLowerCase());

    sessionJwt = verifyJson.sessionJwt;
  });

  it('2. Create Campaign and Verify Budget deductions', async () => {
    // Directly set marketer balance in DB since topup requires live EIP-3009 payment
    await Marketer.updateOne(
      { _id: testAccount.address.toLowerCase() },
      { $set: { balanceUsdc: '10.000000', name: 'Tester Brand' } }
    );

    const campaignData = {
      title: 'Test Video Campaign',
      type: 'video',
      creativeUrl: 'https://example.com/ad.mp4',
      durationMs: 15000,
      ctaUrl: 'https://example.com/cta',
      bidPerViewUsdc: '0.010000',
      budgetUsdc: '2.500000',
      targeting: {
        surfaces: ['frontend'],
      },
      frequencyCapPerSessionPer4h: 1,
    };

    const res = await fetch(`http://localhost:${port}/v1/marketers/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionJwt}`,
      },
      body: JSON.stringify(campaignData),
    });

    expect(res.status).toBe(201);
    const campaign = (await res.json()) as { _id: string; marketerId: string; budgetUsdc: string };
    expect(campaign._id).toBeDefined();
    expect(campaign.marketerId.toLowerCase()).toBe(testAccount.address.toLowerCase());
    expect(campaign.budgetUsdc).toBe('2.500000');

    // Check that marketer balance was decremented by budget (10 - 2.5 = 7.5)
    const marketer = await Marketer.findById(testAccount.address.toLowerCase());
    expect(parseFloat(marketer?.balanceUsdc || '0')).toBe(7.5);
  });

  it('3. Trigger ad watch claim and verify impression creation', async () => {
    // Find campaign we just created
    const campaign = await Campaign.findOne({ marketerId: testAccount.address.toLowerCase() });
    expect(campaign).toBeDefined();

    // Trigger ad claim which writes the impression
    const ad = ADS_REGISTRY[0];
    const claimRes = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: ad.id,
        watchedMs: ad.durationMs,
        walletAddress: '0x0000000000000000000000000000000000000002',
      }),
    });
    expect(claimRes.status).toBe(200);

    // Retrieve impressions for the campaign
    const impRes = await fetch(`http://localhost:${port}/v1/marketers/campaigns/${campaign?._id}/impressions`, {
      headers: {
        'Authorization': `Bearer ${sessionJwt}`,
      },
    });

    expect(impRes.status).toBe(200);
    const impressions = (await impRes.json()) as Array<{ campaignId: string; viewerWallet: string }>;
    expect(impressions.length).toBeGreaterThanOrEqual(1);
    expect(impressions[0].campaignId).toBe(campaign?._id.toString());
  });
});
