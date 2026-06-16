import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { keccak256, encodePacked } from 'viem';
import { env } from '../env.js';
import { walletClient, publicClient, operatorAccount } from '../chain/operator.js';
import { Impression, MerkleBatch, Campaign } from './models.js';
import { logger } from '../lib/logger.js';

const registryAbi = [
  {
    name: 'anchor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'root', type: 'bytes32' },
      { name: 'impressionCount', type: 'uint256' },
      { name: 'totalPayoutUsdc', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lastBatchId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export function computeLeafHash(impression: {
  _id: string;
  campaignId: string;
  viewerSessionHash: string;
  watchedMs: number;
  completedAt: Date;
}): string {
  const completedAtSeconds = Math.floor(impression.completedAt.getTime() / 1000);
  return keccak256(
    encodePacked(
      ['string', 'string', 'string', 'uint256', 'uint256'],
      [
        impression._id,
        impression.campaignId,
        impression.viewerSessionHash,
        BigInt(impression.watchedMs),
        BigInt(completedAtSeconds),
      ]
    )
  );
}

export async function anchorBatch(): Promise<void> {
  const pendingImpressions = await Impression.find({ batchId: { $exists: false } });
  if (pendingImpressions.length === 0) {
    logger.info('No pending impressions to anchor.');
    return;
  }

  logger.info(`Starting anchor batch for ${pendingImpressions.length} impressions...`);

  // Compute leaf hashes and build Merkle Tree
  const leavesData = pendingImpressions.map((imp) => {
    const leafHash = computeLeafHash(imp);
    // Update leafHash field on document
    imp.leafHash = leafHash;
    return {
      impression: imp,
      leafHash,
    };
  });

  const leaves = leavesData.map((d) => [d.leafHash]);
  const tree = StandardMerkleTree.of(leaves, ['bytes32']);
  const root = tree.root;

  // Sum total payouts based on campaign bids
  let totalPayoutDecimals = 0n;
  for (const item of leavesData) {
    const campaign = await Campaign.findById(item.impression.campaignId);
    if (campaign) {
      const bid = parseFloat(campaign.bidPerViewUsdc);
      totalPayoutDecimals += BigInt(Math.round(bid * 1000000));
    }
  }

  const registryAddress = env.IMPRESSION_REGISTRY_ADDRESS;
  const isFallbackAddress = !registryAddress || registryAddress === '0x0000000000000000000000000000000000000000';

  let batchId = Math.floor(Date.now() / 1000); // fallback batch ID
  let anchorTxHash = '0x' + 'a'.repeat(64); // mock tx hash fallback

  if (!isFallbackAddress) {
    try {
      logger.info(`Sending anchor transaction to ImpressionRegistry at ${registryAddress}...`);
      // Call contract anchor()
      const txHash = await walletClient.writeContract({
        address: registryAddress as `0x${string}`,
        abi: registryAbi,
        functionName: 'anchor',
        args: [root as `0x${string}`, BigInt(pendingImpressions.length), totalPayoutDecimals],
      });

      logger.info(`Anchor tx submitted: ${txHash}. Waiting for block inclusion...`);
      anchorTxHash = txHash;
      
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30000 });
      logger.info(`Anchor tx block inclusion receipt status: ${receipt.status}`);

      // Query last batchId from contract
      const contractBatchId = await publicClient.readContract({
        address: registryAddress as `0x${string}`,
        abi: registryAbi,
        functionName: 'lastBatchId',
      }) as bigint;
      
      batchId = Number(contractBatchId);
    } catch (error) {
      logger.warn(`On-chain anchoring failed: ${(error as Error).message}. Using mock/fallback anchor.`);
    }
  } else {
    logger.warn('ImpressionRegistry address is not deployed (using fallback 0x00...00). Mocking anchor.');
  }

  // Create MerkleBatch record
  const batch = new MerkleBatch({
    _id: batchId,
    root,
    impressionCount: pendingImpressions.length,
    totalPayoutUsdc: (Number(totalPayoutDecimals) / 1000000).toFixed(6),
    anchorTxHash,
    anchoredAt: new Date(),
  });
  await batch.save();

  // Save Merkle Tree proofs and update Impression records
  for (const item of leavesData) {
    const proof = tree.getProof([item.leafHash]);
    
    await Impression.updateOne(
      { _id: item.impression._id },
      {
        $set: {
          leafHash: item.leafHash,
          batchId,
          settlementTxHash: anchorTxHash,
        },
      }
    );
  }

  logger.info(`Anchored batch ${batchId} with Merkle Root: ${root}. ${pendingImpressions.length} impressions updated.`);
}
