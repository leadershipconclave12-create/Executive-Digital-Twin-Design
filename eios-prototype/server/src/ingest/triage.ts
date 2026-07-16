import { llm, modelFor, redact, summarizeRedaction } from '../llm/index.js'
import type { ParsedEmail } from './email.js'
import type { Signal, SignalPriority } from '../domain/types.js'
import { bus } from '../events/bus.js'

// REAL email triage. An actual model call, on your actual mail.
//
// This is the workflow that has to earn its keep: 300 emails/day is the biggest single
// consumer of executive time (Vol 2: 12.5 hrs/week). If EIOS cannot triage mail well, the
// rest of the platform is decoration.
//
// Runs on the SMALL model — ~$0.00017/email. 300/day ≈ $0.05/day. $50 ≈ 2.5 years.

export interface TriageVerdict {
  priority: SignalPriority
  /** One line. What it is. */
  summary: string
  /** What the executive (or EIOS) should do. */
  suggestedAction: string
  /** Which AI Office owns it. */
  office: 'intelligence' | 'operations' | 'coordination' | 'analytics' | 'compliance' | 'delivery'
  /** true if this genuinely needs the Deputy Chief, not a delegate. */
  needsExecutive: boolean
  delegateTo?: string
  /** 0-1. Low confidence must route to the executive, not be guessed. */
  confidence: number
  reasoning: string
}

export interface TriagedEmail {
  email: ParsedEmail
  verdict: TriageVerdict
  redaction: string
  costUsd: number
  model: string
}

const SYSTEM = `You are the triage function of an Executive Intelligence Operating System for the Deputy Chief (Products) of an Indian retail bank.

Your ONLY job: decide what this email is and who should handle it. You are the filter that protects ~8 hours of executive time per day.

The executive's domain: UPI/IMPS/NEFT/RTGS payments, digital channels, IT operations, incidents, vendor management, regulatory compliance (RBI/NPCI/DPDPA), programme delivery.

Their direct reports (delegate to these, not the executive, where possible):
- "VP – IT Operations" — incidents, infrastructure, capacity, vendor SLAs
- "VP – Digital Banking" — UPI/mobile/channel performance, customer impact
- "VP – Application Dev" — releases, sprints, delivery
- "Compliance Officer" — RBI circulars, audits, evidence
- "Chief of Staff" — scheduling, meetings, internal comms, board packs

PRIORITY RULES:
- "urgent"        = live customer/money impact, or a regulator waiting. Minutes matter.
- "critical"      = material risk or a decision only the executive can make. Today.
- "routine"       = real work, but a delegate can own it.
- "informational" = FYI, newsletters, automated reports, CC-for-visibility. Nobody acts.

HARD RULES:
1. Be RUTHLESS. Most mail is informational. If you mark everything critical you have failed — you have just recreated the inbox.
2. needsExecutive = true ONLY if a delegate genuinely cannot own it (executive judgment, executive authority, or executive relationship).
3. If you are unsure, say so with LOW confidence and set needsExecutive=true. Escalating an unclear item is safe; silently mis-filing it is not.
4. Some values appear as [ACCOUNT_1], [EMAIL_2] etc. That is redacted PII. Reason about them normally. NEVER guess what they contain.
5. Judge ONLY what is in the email. Do not invent context, incidents, or history.

Reply with ONLY this JSON:
{"priority":"urgent|critical|routine|informational","summary":"one line","suggestedAction":"what to do","office":"intelligence|operations|coordination|analytics|compliance|delivery","needsExecutive":true|false,"delegateTo":"role name or null","confidence":0.0-1.0,"reasoning":"one line: why this priority"}`

function userPrompt(e: ParsedEmail): string {
  return `From: ${e.from}
To: ${e.to}
Date: ${e.date}
Subject: ${e.subject}

${e.body.slice(0, 2500)}`
}

/** Triage one email with a real model call. Redacts before sending. */
export async function triageEmail(e: ParsedEmail): Promise<TriagedEmail> {
  // Redact BEFORE anything leaves this process.
  const r = redact(userPrompt(e))

  const model = modelFor('triage')
  const { value, raw, call } = await llm.completeJson<TriageVerdict>({
    model,
    purpose: 'email-triage',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: r.text },
    ],
    temperature: 0,
    maxTokens: 250,
  })

  // A model that returns garbage must not silently become "informational" — that is how
  // you miss the one email that mattered. Unparseable ⇒ escalate.
  const verdict: TriageVerdict = value ?? {
    priority: 'critical',
    summary: e.subject,
    suggestedAction: 'Review manually — EIOS could not parse the model response.',
    office: 'intelligence',
    needsExecutive: true,
    confidence: 0,
    reasoning: `Model returned unparseable output: ${raw.slice(0, 120)}`,
  }

  // Low confidence ⇒ the executive decides. Never guess on their behalf.
  if (verdict.confidence < 0.5) verdict.needsExecutive = true

  bus.publish('email.triaged', {
    actor: 'EIOS', actorRole: 'system', resource: e.id,
    detail: `${verdict.priority} (conf ${verdict.confidence}) — ${verdict.summary}`,
  })

  return {
    email: e,
    verdict,
    redaction: summarizeRedaction(r.counts),
    costUsd: call.costUsd,
    model: call.model,
  }
}

/** Triage a batch with bounded concurrency — gateways rate-limit, and so should we. */
export async function triageBatch(
  emails: ParsedEmail[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ results: TriagedEmail[]; errors: { id: string; error: string }[]; totalCostUsd: number }> {
  const concurrency = opts.concurrency ?? 4
  const results: TriagedEmail[] = []
  const errors: { id: string; error: string }[] = []
  let cursor = 0

  async function worker() {
    while (cursor < emails.length) {
      const e = emails[cursor++]
      try {
        results.push(await triageEmail(e))
      } catch (err) {
        // Budget exhaustion must stop the whole run, not be swallowed per-email.
        if ((err as Error).message.includes('budget')) throw err
        errors.push({ id: e.id, error: (err as Error).message })
      }
      opts.onProgress?.(results.length + errors.length, emails.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker))
  return {
    results,
    errors,
    totalCostUsd: Number(results.reduce((a, r) => a + r.costUsd, 0).toFixed(5)),
  }
}

/** Convert a triaged email into an EIOS Signal for the priority queue. */
export function toSignal(t: TriagedEmail): Signal {
  const officeName = t.verdict.office.charAt(0).toUpperCase() + t.verdict.office.slice(1)
  return {
    id: t.email.id,
    source: 'Email',
    title: t.email.subject,
    summary: t.verdict.summary,
    priority: t.verdict.priority,
    receivedAt: new Date(t.email.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    suggestedAction: t.verdict.delegateTo && !t.verdict.needsExecutive
      ? `${t.verdict.suggestedAction} → delegate to ${t.verdict.delegateTo}`
      : t.verdict.suggestedAction,
    agent: officeName,
    handled: false,
  }
}

/** The number that decides whether any of this was worth it. */
export function triageStats(results: TriagedEmail[]) {
  const total = results.length
  if (!total) return null
  const needsExec = results.filter((r) => r.verdict.needsExecutive).length
  const byPriority: Record<string, number> = {}
  for (const r of results) byPriority[r.verdict.priority] = (byPriority[r.verdict.priority] ?? 0) + 1

  // Vol 2 baseline: the executive spends ~2 min per email.
  const minutesBefore = total * 2
  const minutesAfter = needsExec * 2
  return {
    total,
    needsExecutive: needsExec,
    filteredOut: total - needsExec,
    reductionPct: Math.round(((total - needsExec) / total) * 100),
    byPriority,
    lowConfidence: results.filter((r) => r.verdict.confidence < 0.5).length,
    minutesSaved: minutesBefore - minutesAfter,
    costUsd: Number(results.reduce((a, r) => a + r.costUsd, 0).toFixed(5)),
    costPerEmailUsd: Number((results.reduce((a, r) => a + r.costUsd, 0) / total).toFixed(6)),
  }
}
