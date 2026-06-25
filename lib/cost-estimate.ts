import { ModelTokenKpi } from "./domain";

export interface CostEstimateInput {
  videoHours: number;
  contextualizationTokens: number;
  tokenUsageByModel: ModelTokenKpi[];
}

export interface CostEstimateBreakdown {
  extractionCost: number;
  contextualizationCost: number;
  llmCost: number;
  totalCost: number;
}

type TokenRates = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
};

const DEFAULT_VIDEO_EXTRACTION_PER_HOUR = 1.0;
const DEFAULT_CONTEXTUALIZATION_PER_MILLION = 1.0;

// Defaults based on the pricing explainer examples and assumptions.
const MODEL_RATES: Record<string, TokenRates> = {
  "gpt-4.1": {
    inputPerMillion: 2.0,
    outputPerMillion: 8.0,
    cachedInputPerMillion: 2.0,
  },
  "gpt-4.1-mini": {
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
    cachedInputPerMillion: 0.4,
  },
};

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

function getRates(model: string): TokenRates {
  return MODEL_RATES[normalizeModelName(model)] || MODEL_RATES["gpt-4.1"];
}

export function estimateContentUnderstandingCost(input: CostEstimateInput): CostEstimateBreakdown {
  const extractionCost = Math.max(0, input.videoHours) * DEFAULT_VIDEO_EXTRACTION_PER_HOUR;
  const contextualizationCost =
    (Math.max(0, input.contextualizationTokens) / 1_000_000) * DEFAULT_CONTEXTUALIZATION_PER_MILLION;

  const llmCost = input.tokenUsageByModel.reduce((sum, usage) => {
    const rates = getRates(usage.model);
    const inputCost = (Math.max(0, usage.inputTokens) / 1_000_000) * rates.inputPerMillion;
    const outputCost = (Math.max(0, usage.outputTokens) / 1_000_000) * rates.outputPerMillion;
    const cachedInputCost =
      (Math.max(0, usage.cachedInputTokens) / 1_000_000) * rates.cachedInputPerMillion;
    const otherCost = (Math.max(0, usage.otherTokens) / 1_000_000) * rates.inputPerMillion;

    return sum + inputCost + outputCost + cachedInputCost + otherCost;
  }, 0);

  return {
    extractionCost,
    contextualizationCost,
    llmCost,
    totalCost: extractionCost + contextualizationCost + llmCost,
  };
}
