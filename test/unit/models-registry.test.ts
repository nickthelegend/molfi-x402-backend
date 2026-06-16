import { describe, it, expect } from 'vitest';
import { MODELS_REGISTRY } from '../../src/chat/models.js';

describe('models-registry.test.ts - Models pricing registry consistency', () => {
  it('should have consistent USDC cost and usdcCostDecimals mapping (6 decimals)', () => {
    for (const [key, model] of Object.entries(MODELS_REGISTRY)) {
      expect(model.id).toBe(key);
      expect(model.usdcCost).toBeGreaterThan(0);
      expect(model.creditCost).toBeGreaterThanOrEqual(1);

      // Verify that usdcCostDecimals represents usdcCost * 10^6
      const expectedDecimals = Math.round(model.usdcCost * 1_000_000);
      expect(model.usdcCostDecimals).toBe(expectedDecimals);
    }
  });

  it('should ensure credit costs are monotonically increasing/non-decreasing relative to USDC costs', () => {
    const sortedModels = Object.values(MODELS_REGISTRY).sort((a, b) => a.usdcCost - b.usdcCost);

    for (let i = 1; i < sortedModels.length; i++) {
      const prev = sortedModels[i - 1];
      const curr = sortedModels[i];

      // A higher or equal USDC cost model should not cost fewer credits than a cheaper USDC cost model
      expect(curr.creditCost).toBeGreaterThanOrEqual(prev.creditCost);
    }
  });
});
