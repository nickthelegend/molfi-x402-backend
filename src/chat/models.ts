export interface ModelConfig {
  id: string;
  name: string;
  openRouterId: string;
  usdcCost: number; // e.g. 0.01
  usdcCostDecimals: number; // e.g. 10000 (0.01 USDC with 6 decimals)
  creditCost: number;
  description: string;
}

export const MODELS_REGISTRY: Record<string, ModelConfig> = {
  'llama-3.3-70b': {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    openRouterId: 'meta-llama/llama-3.3-70b-instruct',
    usdcCost: 0.001,
    usdcCostDecimals: 1000,
    creditCost: 1,
    description: 'High performance open-weights instruction model.',
  },
  'deepseek-v3': {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    openRouterId: 'deepseek/deepseek-chat',
    usdcCost: 0.002,
    usdcCostDecimals: 2000,
    creditCost: 1,
    description: 'Mixture-of-Experts chat model from DeepSeek.',
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    openRouterId: 'google/gemini-2.5-flash',
    usdcCost: 0.003,
    usdcCostDecimals: 3000,
    creditCost: 2,
    description: 'Fast and lightweight multimodal model by Google.',
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    openRouterId: 'openai/gpt-4o-mini',
    usdcCost: 0.005,
    usdcCostDecimals: 5000,
    creditCost: 3,
    description: 'Fast and affordable helper model from OpenAI.',
  },
  'claude-sonnet-4.5': {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    openRouterId: 'anthropic/claude-3.5-sonnet',
    usdcCost: 0.01,
    usdcCostDecimals: 10000,
    creditCost: 5,
    description: 'State-of-the-art intelligence from Anthropic.',
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    openRouterId: 'openai/gpt-4o',
    usdcCost: 0.01,
    usdcCostDecimals: 10000,
    creditCost: 5,
    description: 'OpenAI high-intelligence flagship model.',
  },
  'claude-opus-4.x': {
    id: 'claude-opus-4.x',
    name: 'Claude Opus 3',
    openRouterId: 'anthropic/claude-3-opus',
    usdcCost: 0.03,
    usdcCostDecimals: 30000,
    creditCost: 10,
    description: 'Anthropic master model for complex reasoning.',
  },
};
