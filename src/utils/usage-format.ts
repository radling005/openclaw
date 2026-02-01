import type { NormalizedUsage } from "../agents/usage.js";
import type { OpenClawConfig } from "../config/config.js";

export type ModelCostConfig = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type UsageTotals = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

export function formatTokenCount(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "0";
  }
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1)}m`;
  }
  if (safe >= 1_000) {
    return `${(safe / 1_000).toFixed(safe >= 10_000 ? 0 : 1)}k`;
  }
  return String(Math.round(safe));
}

export function formatUsd(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

export function resolveModelCostConfig(params: {
  provider?: string;
  model?: string;
  config?: OpenClawConfig;
}): ModelCostConfig | undefined {
  const provider = params.provider?.trim();
  const model = params.model?.trim();
  if (!provider || !model) {
    return undefined;
  }
  const providers = params.config?.models?.providers ?? {};
  const entry = providers[provider]?.models?.find((item) => item.id === model);
  return entry?.cost;
}

const toNumber = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function estimateUsageCost(params: {
  usage?: NormalizedUsage | UsageTotals | null;
  cost?: ModelCostConfig;
}): number | undefined {
  const usage = params.usage;
  const cost = params.cost;
  if (!usage || !cost) {
    return undefined;
  }
  const input = toNumber(usage.input);
  const output = toNumber(usage.output);
  const cacheRead = toNumber(usage.cacheRead);
  const cacheWrite = toNumber(usage.cacheWrite);
  const total =
    input * cost.input +
    output * cost.output +
    cacheRead * cost.cacheRead +
    cacheWrite * cost.cacheWrite;
  if (!Number.isFinite(total)) {
    return undefined;
  }
  return total / 1_000_000;
}

/**
 * Estimate CO2 emissions in grams based on token usage.
 *
 * Placeholder algorithm based on rough industry estimates:
 * - ~0.0003 kg CO2 per 1000 tokens (input + output)
 * - This accounts for GPU energy, data center PUE, and average grid carbon intensity
 *
 * Reference: Various LLM carbon footprint studies suggest 0.1-0.5g CO2 per query,
 * with typical queries being 500-2000 tokens total.
 */
export function estimateCarbonGrams(params: {
  usage?: NormalizedUsage | UsageTotals | null;
}): number | undefined {
  const usage = params.usage;
  if (!usage) {
    return undefined;
  }
  const input = toNumber(usage.input);
  const output = toNumber(usage.output);
  const totalTokens = input + output;
  if (totalTokens === 0) {
    return undefined;
  }
  // ~0.3g CO2 per 1000 tokens (0.0003 kg = 0.3g)
  const co2Grams = (totalTokens / 1000) * 0.3;
  return co2Grams;
}

/**
 * Format carbon emissions for display.
 * Shows in grams for small amounts, kg for larger.
 */
export function formatCarbon(grams?: number): string | undefined {
  if (grams === undefined || !Number.isFinite(grams)) {
    return undefined;
  }
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)}kg CO₂`;
  }
  if (grams >= 1) {
    return `${grams.toFixed(1)}g CO₂`;
  }
  if (grams >= 0.01) {
    return `${grams.toFixed(2)}g CO₂`;
  }
  return `${grams.toFixed(3)}g CO₂`;
}
