import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { app } from "../../src/app.js";
import { env } from "../../src/env.js";
import { Server } from "http";
import mongoose from "mongoose";
import { Campaign as AdCampaign, AdImpression } from "../../src/ads/models.js";
import { heartbeatMessage } from "../../src/ads/safety.js";
import { flushBatch } from "../../src/ads/anchor.js";
import { signCreditToken } from "../../src/credits/jwt.js";
import { avalancheFuji } from "../../src/chain/fuji.js";
import { reconcileAdMarket } from "../../src/ads/indexer.js";
import abi from "../../src/abi/MolfiAdMarket.json" assert { type: "json" };

describe("Ad Economy End-to-End Integration Test", () => {
  let server: Server;
  let port: number;
  
  const clientPrivateKey = process.env.TEST_CLIENT_PRIVATE_KEY || "0x0da9ba95d8abb87fe0bd2f4cf110750c1f097f7170dcb9c28a757514a03a2f3c";
  const clientAccount = privateKeyToAccount(clientPrivateKey as `0x${string}`);
  const MARKET = (process.env.AD_MARKET_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;

  const pub = createPublicClient({ 
    chain: avalancheFuji, 
    transport: http(env.FUJI_RPC_URL) 
  });

  const wallet = createWalletClient({
    account: clientAccount,
    chain: avalancheFuji,
    transport: http(env.FUJI_RPC_URL)
  });

  const erc20Abi = [
    {
      name: 'approve',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    },
  ] as const;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(env.MONGODB_URI);
    }
    
    // Clean up test data
    await AdCampaign.deleteMany({ marketer: clientAccount.address.toLowerCase() });
    await AdImpression.deleteMany({ viewer: clientAccount.address.toLowerCase() });

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        port = typeof address === 'string' ? 8787 : address?.port || 8787;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await AdCampaign.deleteMany({ marketer: clientAccount.address.toLowerCase() });
    await AdImpression.deleteMany({ viewer: clientAccount.address.toLowerCase() });
    await mongoose.disconnect();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("Full Ad flow: Start Session -> Heartbeats -> Claim -> Anchor on Fuji", async () => {
    console.log(`Approving Fuji USDC for campaign budget from marketer: ${clientAccount.address}...`);
    const budget = 2n * 10n**6n; // 2 USDC
    const approveHash = await wallet.writeContract({
      address: env.FUJI_USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MARKET, budget],
    });
    await pub.waitForTransactionReceipt({ hash: approveHash });
    console.log("USDC Approved.");

    // Create Campaign on-chain
    console.log("Creating campaign on-chain...");
    const reward = 100_000n; // 0.1 USDC (100,000 units)
    const startTime = BigInt(Math.floor(Date.now() / 1000) - 10);
    const endTime = startTime + 3600n; // 1h duration
    const contentCid = keccak256(toBytes(`test-cid-${Date.now()}`));
    const contentURI = "https://gateway.pinata.cloud/ipfs/QmTestCid";
    const kind = 2; // VIDEO

    const createHash = await wallet.writeContract({
      address: MARKET,
      abi: abi.abi,
      functionName: 'createCampaign',
      args: [contentCid, contentURI, budget, reward, startTime, endTime, kind],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: createHash });
    console.log("Campaign created on-chain.");

    // Retrieve on-chain campaign ID
    const onchainIdBig = await pub.readContract({
      address: MARKET,
      abi: abi.abi,
      functionName: 'nextCampaignId',
    }) as bigint;
    const onchainId = Number(onchainIdBig) - 1;
    console.log(`Indexed campaign ID on-chain is #${onchainId}`);

    // Wait until RPC block height catches up to the receipt's block
    let head = await pub.getBlockNumber();
    console.log(`Campaign confirmed in block ${receipt.blockNumber}. Current RPC height is ${head}.`);
    while (head < receipt.blockNumber) {
      console.log(`Waiting for RPC height (${head}) to reach block (${receipt.blockNumber})...`);
      await new Promise(r => setTimeout(r, 1000));
      head = await pub.getBlockNumber();
    }
    
    // Give Fuji C-chain node logs an extra second to index/propagate
    await new Promise(r => setTimeout(r, 2000));

    // Reconcile indexer
    console.log("Running block indexer to sync campaign to MongoDB...");
    await reconcileAdMarket();

    // Verify it exists in Mongo, then set targeting details
    const campaignDoc = await AdCampaign.findOne({ onchainId });
    expect(campaignDoc).toBeDefined();
    expect(campaignDoc!.marketer).toBe(clientAccount.address.toLowerCase());

    await AdCampaign.updateOne(
      { onchainId },
      {
        $set: {
          title: "E2E Integration Test Campaign",
          targeting: {
            surfaces: ["chat-web"],
            models: ["llama-3.3-70b"]
          }
        }
      }
    );
    // Deactivate all other campaigns in the database to ensure this one is selected
    await AdCampaign.updateMany(
      { onchainId: { $ne: onchainId } },
      { $set: { active: false } }
    );
    console.log("Campaign metadata synchronized in DB (and other campaigns deactivated).");

    // Generate credit JWT for the user to authenticate
    const userJwt = signCreditToken(clientAccount.address.toLowerCase(), 5);

    // 2. Start ad session via POST /v1/ads/start
    console.log("Starting user ad session via POST /v1/ads/start...");
    const startRes = await fetch(`http://localhost:${port}/v1/ads/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userJwt}`
      },
      body: JSON.stringify({
        surface: "chat-web",
        kind: "video",
        modelInUse: "llama-3.3-70b"
      })
    });

    expect(startRes.status).toBe(200);
    const startJson = await startRes.json() as any;
    expect(startJson.sessionId).toBeDefined();
    expect(startJson.nonceHex).toBeDefined();
    expect(startJson.campaignId).toBe(onchainId);
    expect(startJson.contentURI).toBe(contentURI);

    const { sessionId, nonceHex } = startJson;

     // 3. Construct valid heartbeats
    const heartbeats: any[] = [];
    const count = 6;
    for (let i = 0; i < count; i++) {
      const t = i * 1000; // 0, 1000, 2000, 3000, 4000, 5000
      const currentTime = i * 1.0; // 0.0, 1.0, 2.0, 3.0, 4.0, 5.0
      const hb: any = {
        t,
        currentTime,
        paused: false,
        muted: false,
        visible: true,
        focused: true
      };

      // Sign the first and last heartbeat
      if (i === 0 || i === count - 1) {
        const msg = heartbeatMessage(sessionId, nonceHex, hb);
        hb.sig = await clientAccount.signMessage({ message: msg });
      }
      heartbeats.push(hb);
    }

    // 4. Claim reward via POST /v1/ads/claim
    console.log("Submitting ad claim...");
    const claimRes = await fetch(`http://localhost:${port}/v1/ads/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userJwt}`
      },
      body: JSON.stringify({
        sessionId,
        heartbeats,
        watchedMs: 5000
      })
    });

    if (claimRes.status !== 200) {
      console.error("Ad claim failed with status:", claimRes.status);
      console.error(await claimRes.json());
    }

    expect(claimRes.status).toBe(200);
    const claimJson = await claimRes.json() as any;
    expect(claimJson.ok).toBe(true);
    expect(claimJson.sessionId).toBe(sessionId);
    expect(claimJson.rewardPending).toBe(true);

    // Verify DB state is CLAIMED
    const dbImp = await AdImpression.findOne({ sessionId });
    expect(dbImp).toBeDefined();
    expect(dbImp!.status).toBe("CLAIMED");

    // 5. Trigger anchor worker flushBatch()
    console.log("Triggering Merkle batch anchor settlement on Fuji...");
    const flushRes = await flushBatch();
    expect(flushRes).toBeDefined();
    expect(flushRes!.count).toBeGreaterThanOrEqual(1);
    expect(flushRes!.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Verify DB state is ANCHORED
    const dbImpAfter = await AdImpression.findOne({ sessionId });
    expect(dbImpAfter!.status).toBe("ANCHORED");
    expect(dbImpAfter!.txHash).toBe(flushRes!.hash);
    console.log(`Batch settlement successful. Merkle Root anchored in tx ${flushRes!.hash}`);
  }, 60_000); // 60s timeout for live Fuji txs
});
