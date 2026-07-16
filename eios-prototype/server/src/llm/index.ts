import { LlmProvider, type ModelPricing } from './provider.js'

// Model routing — the difference between $50 lasting six weeks and a year.
//
//   300 emails/day on a FRONTIER model  ≈ $1.12/day  → $50 gone in ~6 weeks
//   300 emails/day on a SMALL model     ≈ $0.05/day  → $50 lasts ~2.5 years
//
// So: the small model does the 300 triage decisions nobody will ever read. The frontier
// model is spent only on the ~3 things that reach the executive. This is Volume 3's
// "model strategy" chapter, finally real.

export type Task =
  /** High volume, low stakes, structured output. Cheap model. */
  | 'triage'
  | 'classify'
  | 'summarize'
  /** Low volume, high stakes, needs judgment. Frontier model. */
  | 'reason'
  | 'decide'
  | 'brief'

const CHEAP_TASKS: Task[] = ['triage', 'classify', 'summarize']

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  smallModel: string
  frontierModel: string
  budgetUsd: number
  headers?: Record<string, string>
  pricing: Record<string, ModelPricing>
}

/**
 * Default pricing (USD per 1M tokens, as of mid-2026). Override via EIOS_LLM_PRICING
 * if your internal gateway bills differently — an unknown model defaults to frontier
 * pricing so spend is never under-estimated.
 */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60 },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'claude-haiku-4-5': { inputPer1M: 1.00, outputPer1M: 5.00 },
  'claude-sonnet-5': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-8': { inputPer1M: 5.00, outputPer1M: 25.00 },
  'phi-3-mini': { inputPer1M: 0, outputPer1M: 0 },   // local
  'llama-3.1-8b': { inputPer1M: 0, outputPer1M: 0 }, // local
}

function parsePricing(): Record<string, ModelPricing> {
  const raw = process.env.EIOS_LLM_PRICING
  if (!raw) return DEFAULT_PRICING
  try {
    return { ...DEFAULT_PRICING, ...(JSON.parse(raw) as Record<string, ModelPricing>) }
  } catch {
    return DEFAULT_PRICING
  }
}

function parseHeaders(): Record<string, string> | undefined {
  const raw = process.env.EIOS_LLM_HEADERS
  if (!raw) return undefined
  try { return JSON.parse(raw) as Record<string, string> } catch { return undefined }
}

export const llmSettings: LlmSettings = {
  // Works with: your internal gateway · Azure OpenAI · OpenRouter · LM Studio · Ollama.
  // Anything that speaks the OpenAI chat-completions shape.
  baseUrl: process.env.EIOS_LLM_BASE_URL ?? '',
  apiKey: process.env.EIOS_LLM_API_KEY ?? '',
  smallModel: process.env.EIOS_LLM_SMALL_MODEL ?? 'gpt-4o-mini',
  frontierModel: process.env.EIOS_LLM_FRONTIER_MODEL ?? 'gpt-4o',
  budgetUsd: Number(process.env.EIOS_LLM_BUDGET_USD ?? 50),
  headers: parseHeaders(),
  pricing: parsePricing(),
}

export const llm = new LlmProvider({
  baseUrl: llmSettings.baseUrl,
  apiKey: llmSettings.apiKey,
  headers: llmSettings.headers,
  pricing: llmSettings.pricing,
  budgetUsd: llmSettings.budgetUsd,
})

/** Pick the model for a task. The whole cost strategy in one function. */
export function modelFor(task: Task): string {
  return CHEAP_TASKS.includes(task) ? llmSettings.smallModel : llmSettings.frontierModel
}

export function llmStatus() {
  return {
    configured: llm.isConfigured(),
    baseUrl: llmSettings.baseUrl ? llmSettings.baseUrl.replace(/\/\/([^@]+)@/, '//***@') : null,
    smallModel: llmSettings.smallModel,
    frontierModel: llmSettings.frontierModel,
    routing: { cheap: CHEAP_TASKS, frontier: ['reason', 'decide', 'brief'] },
    cost: llm.ledger.report(),
    note: llm.isConfigured()
      ? 'Real reasoning enabled.'
      : 'NOT CONFIGURED — EIOS is running on rules only. Set EIOS_LLM_BASE_URL to enable real reasoning.',
  }
}

export { LlmProvider, BudgetExceededError, LlmNotConfiguredError } from './provider.js'
export type { ChatMessage, LlmCall, CompleteResult } from './provider.js'
export { redact, unredact, hasPii, summarizeRedaction } from './redact.js'
