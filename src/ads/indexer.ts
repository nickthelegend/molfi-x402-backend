import { createPublicClient, http, parseAbiItem } from "viem";
import { avalancheFuji } from "viem/chains";
import { Campaign } from "./models.js";
import abi from "../abi/MolfiAdMarket.json" with { type: "json" };

const rpcUrl = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const MARKET = (process.env.AD_MARKET_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;

const client = createPublicClient({ 
  chain: avalancheFuji, 
  transport: http(rpcUrl) 
});

let lastBlock = 0n;

export async function reconcileAdMarket() {
  try {
    const head = await client.getBlockNumber();
    if (lastBlock === 0n) {
      lastBlock = head - 2000n; // scan last 2000 blocks on startup
    }
    const from = lastBlock + 1n;
    if (from > head) return;

    console.log(`[indexer] Scanning Fuji C-Chain logs from block ${from} to ${head}...`);

    // 1. Get CampaignCreated logs
    const createdLogs = await client.getLogs({
      address: MARKET,
      fromBlock: from,
      toBlock: head,
      event: parseAbiItem("event CampaignCreated(uint256 indexed id, address indexed marketer, bytes32 contentCid, uint256 budget, uint256 rewardPerImpression, uint8 kind)")
    });

    for (const log of createdLogs) {
      const { id, marketer, contentCid, budget, rewardPerImpression, kind } = log.args;
      if (!id) continue;

      console.log(`[indexer] CampaignCreated event indexed: ID #${id}, marketer: ${marketer}`);

      const onchain = await client.readContract({
        address: MARKET,
        abi: abi.abi,
        functionName: "campaigns",
        args: [id]
      }) as any;

      // Campaign struct details from contract mapping:
      // address marketer, bytes32 contentCid, string contentURI, uint256 budgetRemaining, uint256 rewardPerImpression, uint64 startTime, uint64 endTime, AdKind kind, bool active
      const startTime = new Date(Number(onchain[5]) * 1000);
      const endTime = new Date(Number(onchain[6]) * 1000);

      await Campaign.updateOne(
        { onchainId: Number(id) },
        { 
          $setOnInsert: {
            onchainId: Number(id),
            marketer: marketer!.toLowerCase(),
            contentCid: contentCid || "",
            contentURI: onchain[2] || "",
            title: `Campaign #${id}`,
            kind: ["TEXT", "IMAGE", "VIDEO"][Number(kind)],
            rewardPerImpression: rewardPerImpression!.toString(),
            budgetRemaining: budget!.toString(),
            startTime,
            endTime,
            active: true,
          } 
        },
        { upsert: true }
      );
    }

    // 2. Get CampaignFunded logs
    const fundedLogs = await client.getLogs({
      address: MARKET,
      fromBlock: from,
      toBlock: head,
      event: parseAbiItem("event CampaignFunded(uint256 indexed id, uint256 amount, uint256 newBudget)")
    });

    for (const log of fundedLogs) {
      const { id, newBudget } = log.args;
      if (!id) continue;
      console.log(`[indexer] CampaignFunded event indexed: ID #${id}, new budget: ${newBudget}`);
      await Campaign.updateOne(
        { onchainId: Number(id) },
        { $set: { budgetRemaining: newBudget!.toString() } }
      );
    }

    // 3. Get CampaignClosed logs
    const closedLogs = await client.getLogs({
      address: MARKET,
      fromBlock: from,
      toBlock: head,
      event: parseAbiItem("event CampaignClosed(uint256 indexed id, address indexed marketer, uint256 refunded)")
    });

    for (const log of closedLogs) {
      const { id } = log.args;
      if (!id) continue;
      console.log(`[indexer] CampaignClosed event indexed: ID #${id}`);
      await Campaign.updateOne(
        { onchainId: Number(id) },
        { $set: { active: false, budgetRemaining: "0" } }
      );
    }

    lastBlock = head;
  } catch (err: any) {
    console.error("[indexer] Error reconciling ad market events:", err.message);
  }
}

export function startIndexer() {
  console.log("[indexer] Starting Fuji ad market events indexer daemon...");
  reconcileAdMarket().catch(console.error);
  setInterval(() => reconcileAdMarket().catch(console.error), 15_000);
}
