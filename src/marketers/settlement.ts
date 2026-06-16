import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { keccak256, encodePacked } from 'viem';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../env.js';
import { walletClient, publicClient, operatorAccount } from '../chain/operator.js';
import { Impression, MerkleBatch, Campaign } from './models.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registryAddress = env.IMPRESSION_REGISTRY_ADDRESS;

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
  durationMs?: number;
  watchedMs?: number;
  completedAt?: Date;
}): string {
  const completedAtSeconds = Math.floor((impression.completedAt || new Date()).getTime() / 1000);
  const duration = impression.durationMs !== undefined ? impression.durationMs : (impression.watchedMs || 0);
  return keccak256(
    encodePacked(
      ['string', 'string', 'string', 'uint256', 'uint256'],
      [
        impression._id,
        impression.campaignId,
        impression.viewerSessionHash,
        BigInt(duration),
        BigInt(completedAtSeconds),
      ]
    )
  );
}

export async function maybeAnchorBatch(): Promise<void> {
  try {
    const pending = await Impression.find({ status: 'claimed', batchId: { $exists: false } })
      .sort({ completedAt: 1 })
      .lean();

    if (pending.length === 0) {
      return;
    }

    const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
    const BATCH_THRESHOLD = isDev ? 3 : 50;
    const BATCH_MAX_AGE_MS = isDev ? 5000 : 30 * 60 * 1000;

    const oldest = pending[0].completedAt ? pending[0].completedAt.getTime() : Date.now();
    if (pending.length < BATCH_THRESHOLD && Date.now() - oldest < BATCH_MAX_AGE_MS) {
      return;
    }

    logger.info(`Starting anchor batch for ${pending.length} impressions...`);

    // Format leaves
    const leaves = pending.map((p: any) => {
      const completedAtSeconds = Math.floor((p.completedAt || new Date()).getTime() / 1000);
      return [
        p._id.toString(),
        p.campaignId.toString(),
        p.viewerSessionHash,
        p.durationMs.toString(),
        completedAtSeconds.toString(),
      ];
    });

    const tree = StandardMerkleTree.of(leaves, ['string', 'string', 'string', 'uint256', 'uint256']);
    const root = tree.root;

    // Sum total payouts
    const totalPayoutDecimals = pending.reduce((s, p: any) => {
      const bid = parseFloat(p.bidPaidUsdc);
      return s + BigInt(Math.round(bid * 1e6));
    }, 0n);

    let batchId = Math.floor(Date.now() / 1000);
    let anchorTxHash = '0x' + 'a'.repeat(64);

    const isFallbackAddress = !registryAddress || registryAddress === '0x0000000000000000000000000000000000000000';

    if (isFallbackAddress) {
      if (env.NODE_ENV === 'production') {
        throw new Error('IMPRESSION_REGISTRY_ADDRESS missing in production');
      }
      logger.warn('ImpressionRegistry address not deployed (using fallback 0x00...00). Mocking anchor.');
    } else {
      logger.info(`Submitting anchor transaction to contract ${registryAddress}...`);
      const hash = await walletClient.writeContract({
        address: registryAddress as `0x${string}`,
        abi: registryAbi,
        functionName: 'anchor',
        args: [root as `0x${string}`, BigInt(pending.length), totalPayoutDecimals],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30000 });
      if (receipt.status !== 'success') {
        throw new Error('On-chain anchor transaction reverted');
      }

      anchorTxHash = hash;

      // Extract batchId from topics[1] of BatchAnchored event log
      const regLog = receipt.logs.find(l => l.address.toLowerCase() === registryAddress.toLowerCase());
      if (regLog && regLog.topics[1]) {
        batchId = Number(BigInt(regLog.topics[1]));
      } else {
        // Fallback reading contract directly
        const lastBatchVal = await publicClient.readContract({
          address: registryAddress as `0x${string}`,
          abi: registryAbi,
          functionName: 'lastBatchId',
        });
        batchId = Number(lastBatchVal);
      }
    }

    // Dump leaves & proofs to public directory
    const batchesDir = path.resolve(__dirname, '../../../public/batches');
    if (!fs.existsSync(batchesDir)) {
      fs.mkdirSync(batchesDir, { recursive: true });
    }

    const dumpData = {
      batchId,
      root,
      leaves: pending.map((p: any, idx) => {
        const completedAtSeconds = Math.floor((p.completedAt || new Date()).getTime() / 1000);
        const leafHash = keccak256(
          encodePacked(
            ['string', 'string', 'string', 'uint256', 'uint256'],
            [
              p._id.toString(),
              p.campaignId.toString(),
              p.viewerSessionHash,
              BigInt(p.durationMs),
              BigInt(completedAtSeconds),
            ]
          )
        );
        return {
          id: p._id,
          leafHash,
          proof: tree.getProof(idx),
        };
      }),
    };

    fs.writeFileSync(path.join(batchesDir, `${batchId}.json`), JSON.stringify(dumpData, null, 2));

    // Save MerkleBatch record
    const batch = new MerkleBatch({
      _id: batchId,
      batchId,
      root,
      impressionCount: pending.length,
      totalPayoutUsdc: (Number(totalPayoutDecimals) / 1e6).toFixed(6),
      anchorTxHash,
      anchoredAt: new Date(),
      fileUrl: `/batches/${batchId}.json`,
    });
    await batch.save();

    // Update Impression records in DB
    for (let idx = 0; idx < pending.length; idx++) {
      const p = pending[idx] as any;
      const completedAtSeconds = Math.floor((p.completedAt || new Date()).getTime() / 1000);
      const leafHash = keccak256(
        encodePacked(
          ['string', 'string', 'string', 'uint256', 'uint256'],
          [
            p._id.toString(),
            p.campaignId.toString(),
            p.viewerSessionHash,
            BigInt(p.durationMs),
            BigInt(completedAtSeconds),
          ]
        )
      );

      await Impression.updateOne(
        { _id: p._id },
        {
          $set: {
            batchId,
            leafHash,
            settlementTxHash: anchorTxHash,
          },
        }
      );
    }

    logger.info(`Successfully anchored Merkle Batch #${batchId}`);
  } catch (error) {
    logger.error(`Error in maybeAnchorBatch: ${(error as Error).message}`);
  }
}
export { maybeAnchorBatch as anchorBatch };
