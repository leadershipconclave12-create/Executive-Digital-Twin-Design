import { bus } from '../events/bus.js'

// A REAL LLM client. Not a mock.
//
// Speaks the OpenAI Chat Completions wire format, which is what almost every internal
// gateway, Azure OpenAI, OpenRouter, LM Studio and Ollama expose. Point EIOS_LLM_BASE_URL
// at your internal tool and it works — no code change.
//
// TWO NON-NEGOTIABLES, because the user has ~$50 and a bank laptop:
//   1. Every call is metered. You always know what you have spent.
//   2. A hard budget stop. When credits are exhausted EIOS refuses to call, loudly,
//      rather than failing in a way you discover on a bill.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPer1M: number
  /** USD per 1M output tokens. */
  outputPer1M: number
}

export interface LlmCall {
  at: string
  model: string
  purpose: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  latencyMs: number
}

export interface CompleteOptions {
  model: string
  /** What this call is for — appears in the cost ledger so spend is attributable. */
  purpose: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** Ask the model for strict JSON. */
  json?: boolean
}

export interface CompleteResult {
  text: string
  call: LlmCall
}

export class BudgetExceededError extends Error {
  constructor(spent: number, budget: number) {
    super(`LLM budget exhausted: $${spent.toFixed(4)} of $${budget.toFixed(2)} used. Refusing further calls. Raise EIOS_LLM_BUDGET_USD or reset the ledger.`)
  }
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('No LLM configured. Set EIOS_LLM_BASE_URL and EIOS_LLM_API_KEY (see .env.example). Until then EIOS runs on rules only and will say so.')
  }
}

/** Tracks spend so $50 is never a surprise. */
export class CostLedger {
  private calls: LlmCall[] = []
  constructor(private budgetUsd: number) {}

  record(call: LlmCall): void {
    this.calls.push(call)
    bus.publish('llm.call', {
      actor: 'EIOS', actorRole: 'system', resource: call.model,
      detail: `${call.purpose}: ${call.promptTokens}+${call.completionTokens} tok, $${call.costUsd.toFixed(5)}`,
    })
  }

  spent(): number { return this.calls.reduce((a, c) => a + c.costUsd, 0) }
  remaining(): number { return Math.max(0, this.budgetUsd - this.spent()) }
  budget(): number { return this.budgetUsd }
  count(): number { return this.calls.length }
  history(limit = 50): LlmCall[] { return this.calls.slice(-limit).reverse() }

  /** Check BEFORE spending. */
  assertWithinBudget(): void {
    if (this.spent() >= this.budgetUsd) throw new BudgetExceededError(this.spent(), this.budgetUsd)
  }

  report() {
    const byPurpose: Record<string, { calls: number; costUsd: number }> = {}
    for (const c of this.calls) {
      const e = byPurpose[c.purpose] ?? { calls: 0, costUsd: 0 }
      e.calls += 1; e.costUsd += c.costUsd
      byPurpose[c.purpose] = e
    }
    for (const k of Object.keys(byPurpose)) byPurpose[k].costUsd = Number(byPurpose[k].costUsd.toFixed(5))

    const spent = this.spent()
    const perCall = this.calls.length ? spent / this.calls.length : 0
    return {
      budgetUsd: this.budgetUsd,
      spentUsd: Number(spent.toFixed(5)),
      remainingUsd: Number(this.remaining().toFixed(5)),
      calls: this.calls.length,
      avgCostPerCallUsd: Number(perCall.toFixed(6)),
      /** The number that actually matters on a fixed credit allowance. */
      projectedCallsRemaining: perCall > 0 ? Math.floor(this.remaining() / perCall) : null,
      byPurpose,
    }
  }
}

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  /** Extra headers — some internal gateways want their own auth header. */
  headers?: Record<string, string>
  pricing: Record<string, ModelPricing>
  budgetUsd: number
}

export class LlmProvider {
  readonly ledger: CostLedger
  constructor(private cfg: LlmConfig) {
    this.ledger = new CostLedger(cfg.budgetUsd)
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.baseUrl)
  }

  private priceOf(model: string): ModelPricing {
    // Unknown model → assume frontier pricing. Over-estimating spend is safe;
    // under-estimating is how you blow a budget silently.
    return this.cfg.pricing[model] ?? { inputPer1M: 5, outputPer1M: 15 }
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    if (!this.isConfigured()) throw new LlmNotConfiguredError()
    this.ledger.assertWithinBudget()

    const started = Date.now()
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 800,
    }
    if (opts.json) body.response_format = { type: 'json_object' }

    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}`, 'api-key': this.cfg.apiKey } : {}),
        ...this.cfg.headers,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`LLM ${res.status} from ${this.cfg.baseUrl}: ${detail.slice(0, 300)}`)
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const text = data.choices?.[0]?.message?.content ?? ''

    // Some gateways omit usage. Estimate rather than record zero — a silent $0 is a lie.
    const promptTokens = data.usage?.prompt_tokens ?? estimateTokens(opts.messages.map((m) => m.content).join(' '))
    const completionTokens = data.usage?.completion_tokens ?? estimateTokens(text)
    const p = this.priceOf(opts.model)
    const costUsd = (promptTokens / 1e6) * p.inputPer1M + (completionTokens / 1e6) * p.outputPer1M

    const call: LlmCall = {
      at: new Date().toISOString(),
      model: opts.model,
      purpose: opts.purpose,
      promptTokens,
      completionTokens,
      costUsd,
      latencyMs: Date.now() - started,
    }
    this.ledger.record(call)
    return { text, call }
  }

  /** Convenience: parse a JSON response, returning null rather than throwing on garbage. */
  async completeJson<T>(opts: CompleteOptions): Promise<{ value: T | null; raw: string; call: LlmCall }> {
    const { text, call } = await this.complete({ ...opts, json: true })
    try {
      // Tolerate models that wrap JSON in prose or fences.
      const m = text.match(/\{[\s\S]*\}/)
      return { value: JSON.parse(m ? m[0] : text) as T, raw: text, call }
    } catch {
      return { value: null, raw: text, call }
    }
  }
}

/** ~4 chars per token. Crude, but only used when the gateway hides usage. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}
