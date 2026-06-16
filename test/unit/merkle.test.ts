import { describe, it, expect } from 'vitest';
import { computeLeafHash } from '../../src/marketers/settlement.js';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

describe('merkle.test.ts - Merkle Tree and Proof validations', () => {
  it('should compute deterministic leaf hash for an impression', () => {
    const completedAt = new Date('2026-06-16T12:00:00.000Z');
    const impression = {
      _id: 'imp-12345',
      campaignId: 'camp-67890',
      viewerSessionHash: 'hash-abcde',
      watchedMs: 15000,
      completedAt,
    };

    const hash1 = computeLeafHash(impression);
    expect(hash1).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Re-computing with the same input should yield identical hash
    const hash2 = computeLeafHash(impression);
    expect(hash2).toBe(hash1);

    // Different watchedMs should yield a different hash
    const hash3 = computeLeafHash({ ...impression, watchedMs: 14999 });
    expect(hash3).not.toBe(hash1);
  });

  it('should build a valid Merkle tree and verify proofs', () => {
    const completedAt = new Date('2026-06-16T12:00:00.000Z');
    const imps = [
      { _id: '1', campaignId: 'c1', viewerSessionHash: 'v1', watchedMs: 1000, completedAt },
      { _id: '2', campaignId: 'c1', viewerSessionHash: 'v2', watchedMs: 2000, completedAt },
      { _id: '3', campaignId: 'c1', viewerSessionHash: 'v3', watchedMs: 3000, completedAt },
      { _id: '4', campaignId: 'c1', viewerSessionHash: 'v4', watchedMs: 4000, completedAt },
    ];

    const leafHashes = imps.map((imp) => computeLeafHash(imp));
    const leaves = leafHashes.map((h) => [h]);
    
    // Create standard Merkle tree of type bytes32
    const tree = StandardMerkleTree.of(leaves, ['bytes32']);
    
    expect(tree.root).toBeDefined();
    expect(tree.root).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Verify proof for each leaf
    leafHashes.forEach((hash, index) => {
      const proof = tree.getProof([hash]);
      expect(proof).toBeDefined();
      expect(proof.length).toBeGreaterThan(0);
      
      const verified = StandardMerkleTree.verify(tree.root, ['bytes32'], [hash], proof);
      expect(verified).toBe(true);
    });
  });
});
