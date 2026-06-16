import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { Impression, MerkleBatch } from './models.js';
import { computeLeafHash } from './settlement.js';
import { env } from '../env.js';

export async function verifyImpressionProof(impressionId: string) {
  const impression = await Impression.findById(impressionId);
  if (!impression) {
    throw new Error('Impression not found');
  }

  // Ensure leafHash exists
  if (!impression.leafHash) {
    impression.leafHash = computeLeafHash(impression);
  }

  let batch = null;
  let proof: string[] = [];
  let snowtraceUrl = '';

  if (impression.batchId !== undefined) {
    batch = await MerkleBatch.findById(impression.batchId);
    if (batch) {
      // Rebuild tree deterministically
      const impressionsInBatch = await Impression.find({ batchId: impression.batchId }).sort({ _id: 1 });
      
      const leaves = impressionsInBatch.map((imp) => {
        if (!imp.leafHash) {
          imp.leafHash = computeLeafHash(imp);
        }
        return [imp.leafHash];
      });

      const tree = StandardMerkleTree.of(leaves, ['bytes32']);
      const leafIndex = impressionsInBatch.findIndex((imp) => imp._id === impression._id);
      if (leafIndex !== -1) {
        proof = tree.getProof(leafIndex);
      }
      
      if (batch.anchorTxHash) {
        const explorerBase = env.FUJI_EXPLORER_BASE || 'https://testnet.snowtrace.io';
        snowtraceUrl = `${explorerBase}/tx/${batch.anchorTxHash}`;
      }
    }
  }

  return {
    impression,
    batch,
    proof,
    snowtraceUrl,
  };
}
