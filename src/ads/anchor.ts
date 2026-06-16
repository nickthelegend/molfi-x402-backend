import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { AdImpression, Campaign } from "./models.js";
import abi from "../abi/MolfiAdMarket.json" with { type: "json" };
import { keccak256, encodeAbiParameters, toHex } from "viem";

const rpcUrl = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const privateKey = process.env.SERVER_WALLET_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";
const MARKET = (process.env.AD_MARKET_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;

const account = privateKeyToAccount(privateKey as `0x${string}`);
const wallet  = createWalletClient({ account, chain: avalancheFuji, transport: http(rpcUrl) });
const pub     = createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) });

const BATCH_SIZE = 50;
const ANCHOR_INTERVAL_MS = 30_000;

export async function flushBatch() {
  try {
    const claimed = await AdImpression.find({ status: "CLAIMED" }).limit(BATCH_SIZE);
    if (!claimed.length) return null;

    console.log(`[anchor] Found ${claimed.length} claimed impressions. Preparing batch settlement...`);

    const receiptIds:  `0x${string}`[] = [];
    const campaignIds: bigint[] = [];
    const viewers:     `0x${string}`[] = [];
    const amounts:     bigint[] = [];
    const matchedImps: any[] = [];

    for (const imp of claimed) {
      const c = await Campaign.findOne({ onchainId: imp.campaignId });
      if (!c) {
        console.warn(`[anchor] Campaign ID ${imp.campaignId} not found in DB for impression ${imp.receiptId}, skipping...`);
        continue;
      }
      receiptIds.push(imp.receiptId as `0x${string}`);
      campaignIds.push(BigInt(imp.campaignId));
      viewers.push(imp.viewer as `0x${string}`);
      amounts.push(BigInt(c.rewardPerImpression));
      matchedImps.push(imp);
    }

    if (!matchedImps.length) return null;

    const leaves = receiptIds.map((rid, i) => keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
      [rid, campaignIds[i], viewers[i], amounts[i]]
    )));
    
    const merkleRoot = leaves.length ? merkle(leaves) : toHex(new Uint8Array(32), { size: 32 });

    console.log(`[anchor] Submitting batchAnchor with Merkle root ${merkleRoot} on-chain...`);

    const hash = await wallet.writeContract({
      address: MARKET,
      abi: abi.abi,
      functionName: "batchAnchor",
      args: [merkleRoot, receiptIds, campaignIds, viewers, amounts],
    });

    console.log(`[anchor] Transaction submitted. Hash: ${hash}. Waiting for block receipt...`);
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") {
      throw new Error("anchor transaction reverted on-chain");
    }

    console.log(`[anchor] Merkle batch anchored successfully. Tx status: ${rcpt.status}`);

    // Update impressions status in DB
    await AdImpression.updateMany(
      { _id: { $in: matchedImps.map(i => i._id) } },
      { $set: { status: "ANCHORED", txHash: hash } }
    );

    return { hash, count: matchedImps.length };
  } catch (err: any) {
    console.error("[anchor] Merkle batch anchor worker failed:", err.message);
    throw err;
  }
}

function merkle(leaves: `0x${string}`[]): `0x${string}` {
  if (leaves.length === 1) return leaves[0];
  const next: `0x${string}`[] = [];
  for (let i = 0; i < leaves.length; i += 2) {
    const a = leaves[i], b = leaves[i+1] ?? leaves[i];
    const [x, y] = a < b ? [a, b] : [b, a];
    next.push(keccak256(`0x${x.slice(2)}${y.slice(2)}` as `0x${string}`));
  }
  return merkle(next);
}

export function startAnchorWorker() {
  console.log("[anchor] Starting background Merkle anchor worker daemon...");
  setInterval(() => {
    flushBatch().then(r => r && console.log("[anchor] Batch finished:", r)).catch(console.error);
  }, ANCHOR_INTERVAL_MS);
}
