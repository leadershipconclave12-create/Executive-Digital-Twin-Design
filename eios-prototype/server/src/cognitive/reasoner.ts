import { llm, modelFor, redact, unredact } from '../llm/index.js'
import type { Store } from '../data/store.js'
import type { User } from '../domain/types.js'
import { memory } from '../memory/seed.js'
import { recall } from '../memory/recall.js'
import { LLM_ACCESS } from '../memory/fabric.js'
import { perception } from '../perception/index.js'
import { pulse } from '../twin/pulse.js'

// Grounded reasoning — the fallback when no rule matches.
//
// The rules handle the known workflows deterministically (cheap, fast, auditable). This
// handles everything else. It is the ONLY place a model is allowed to talk to the
// executive in free text, and it is fenced hard:
//
//   1. It sees ONLY the twin + memory the CALLER is allowed to see (governance holds —
//      the model cannot become a privilege-escalation path).
//   2. It must answer from that context or say it does not know (Standard S9/S10).
//   3. It must cite. An uncited claim is treated as a failure, not a feature.
//
// Costs the frontier model (~$0.004/question). At 20 questions/day ≈ $2.40/month.

const SYSTEM = `You are EIOS, the Executive Intelligence Operating System for the Deputy Chief (Products) of an Indian retail bank. You serve exactly one person: him.

You are answering the executive directly. You have been given a CONTEXT block containing the live state of the organization and its institutional memory. That block is everything you know.

ABSOLUTE RULES:
1. Answer ONLY from CONTEXT. If the answer is not there, say exactly what you do not know and stop. Never fill a gap with a plausible guess.
2. Cite the record id (e.g. D-193, INC-4521, L-1, PRJ-A) for every factual claim.
3. Never invent numbers, dates, names, incidents, or history. A fabricated organizational fact destroys trust in the whole system permanently.
4. Values like [ACCOUNT_1] or [EMAIL_2] are redacted PII. Reason about them; never guess their contents.
4b. Some records are withheld from you entirely (personal/restricted). If CONTEXT says so, tell the executive the information exists but you cannot see it. Never speculate about it.
5. Be brief. The executive has minutes, not patience. 3 sentences unless asked for more.
6. If CONTEXT shows "liveSources: 0", the organizational data is SIMULATED. Say so if the answer depends on it.
7. State uncertainty plainly. "The record is stale (last verified March)" is more useful than false confidence.

You are talking to a senior banking executive. No preamble, no filler, no "I'd be happy to help".`

/**
 * Assemble the context for an EXTERNAL MODEL.
 *
 * Uses LLM_ACCESS, not the executive's own view. He may read his 1:1 coaching notes; a
 * prompt leaving this machine may not carry them. This is the single most important line
 * in this file — the boundary is enforced here, at assembly, not by asking the model
 * nicely to ignore things.
 */
function buildContext(store: Store, _user: User, question: string): string {
  const ctx = LLM_ACCESS
  const twin = perception.twin()
  const snap = pulse.snapshot()
  const p = perception.report()

  // Memory: use the same recall engine, so the model gets provenance-checked records
  // rather than raw graph dumps — and redactions already applied for this role.
  const memHit = recall(memory, question, ctx)

  const lines: string[] = []
  lines.push(`## DATA PROVENANCE`)
  lines.push(`liveSources: ${p.liveSources} (0 = organizational data is SIMULATED, not real)`)
  lines.push('')
  lines.push(`## LIVE ORGANIZATION (twin, tick ${snap.tick}, health ${snap.organizationHealth}/100)`)
  lines.push(`Channels: ${twin.channels.map((c) => `${c.name} ${c.successRate.toFixed(1)}% (${c.status})`).join(', ')}`)
  lines.push(`Projects: ${twin.projects.map((x) => `${x.id} "${x.name}" ${x.completion.toFixed(0)}% vs plan ${x.plannedCompletion.toFixed(0)}%, risk ${x.riskScore.toFixed(0)}, due ${x.deadline}`).join(' | ')}`)
  lines.push(`Vendors: ${twin.vendors.map((v) => `${v.name} SLA ${v.slaAttainment.toFixed(1)}%, ${v.breachesThisQuarter} breaches${v.renewalInDays !== undefined ? `, renewal in ${v.renewalInDays}d` : ''}`).join(' | ')}`)
  lines.push(`Releases: ${twin.releases.map((r) => `${r.id} "${r.name}" risk ${r.riskScore.toFixed(0)}, readiness ${r.readiness.toFixed(0)}%, ships ${r.scheduledIn}`).join(' | ')}`)
  lines.push(`Incidents: ${store.incidents.map((i) => `${i.id} ${i.severity} "${i.title}" (${i.status}, owner ${i.owner})`).join(' | ')}`)
  lines.push('')
  lines.push(`## OFFICE HEALTH`)
  lines.push(snap.offices.map((o) => `${o.name}: ${o.score}/100 (${o.band}) — ${o.headline}`).join('\n'))
  lines.push('')
  lines.push(`## NEEDS THE EXECUTIVE TODAY`)
  lines.push(snap.attention.forExecutive.map((a) => `- ${a.title} — ${a.why} → ${a.recommendedAction}`).join('\n') || '- nothing')
  lines.push('')
  lines.push(`## DECISIONS PENDING`)
  lines.push(store.decisions.filter((d) => d.status === 'pending')
    .map((d) => `${d.id} ${d.type} [${d.tier}, ${d.risk} risk${d.amountLabel ? `, ${d.amountLabel}` : ''}] — ${d.summary} → recommended: ${d.recommendation}`).join('\n') || 'none')
  lines.push('')
  lines.push(`## DELEGATIONS ACTIVE`)
  lines.push(store.delegations.map((d) => `${d.id} → ${d.delegate}: "${d.subject}" (${d.status}, ${d.progress}%, due ${d.deadline})`).join('\n') || 'none')

  if (memHit.basis.length) {
    lines.push('')
    lines.push(`## INSTITUTIONAL MEMORY (relevant to this question)`)
    lines.push(memHit.answer)
    lines.push('Sources: ' + memHit.basis.slice(0, 8).map((b) => `${b.nodeId} (${b.provenance.source}, ${b.provenance.confidence})`).join('; '))
    if (memHit.validity && memHit.validity.state !== 'holds') {
      lines.push(`WARNING — validity ${memHit.validity.state}: ${memHit.validity.brokenAssumptions.join('; ')}`)
    }
    if (memHit.gaps.length) lines.push('KNOWN GAPS: ' + memHit.gaps.join(' '))
    if (memHit.redactions.count) {
      lines.push(`NOTE: ${memHit.redactions.count} record(s) exist but are withheld from you as personal/restricted. Do not speculate about their contents.`)
    }
  }

  const lessons = memory.lessonsFor(question.toLowerCase().split(/\s+/), ctx)
  if (lessons.length) {
    lines.push('')
    lines.push(`## ORGANIZATIONAL LESSONS THAT APPLY`)
    lines.push(lessons.map((l) => `${l.id}: ${l.rule} (learned from: ${l.scar})`).join('\n'))
  }

  const judgments = memory.judgmentsFor(question.toLowerCase().split(/\s+/), ctx)
  if (judgments.length) {
    lines.push('')
    lines.push(`## THIS EXECUTIVE'S OWN JUDGMENT (apply it)`)
    lines.push(judgments.map((j) => `${j.id}: when ${j.trigger} → ${j.judgment}. Because: ${j.because}`).join('\n'))
  }

  return lines.join('\n')
}

export interface ReasonedAnswer {
  reply: string
  model: string
  costUsd: number
  latencyMs: number
  /** PII placeholders were substituted before sending. */
  redacted: boolean
  /** Whole records withheld from the model as personal/restricted. */
  recordsWithheld: number
}

/** Answer a free-form executive question, grounded and governed. */
export async function reason(store: Store, user: User, question: string): Promise<ReasonedAnswer> {
  const context = buildContext(store, user, question)

  // Redact the whole payload — context may carry PII from ingested mail.
  const r = redact(`CONTEXT\n${context}\n\nQUESTION FROM ${user.title}: ${question}`)

  const { text, call } = await llm.complete({
    model: modelFor('reason'),
    purpose: 'one-prompt-reasoning',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: r.text },
    ],
    temperature: 0.1,
    maxTokens: 500,
  })

  return {
    // Restore real values for the executive — the model never saw them.
    reply: unredact(text.trim(), r.map),
    model: call.model,
    costUsd: call.costUsd,
    latencyMs: call.latencyMs,
    redacted: r.map.size > 0,
    recordsWithheld: memory.llmWithheld().length,
  }
}
