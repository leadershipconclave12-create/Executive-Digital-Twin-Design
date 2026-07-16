import type { User } from '../domain/types.js'
import type { Store } from '../data/store.js'
import { bus, Events } from '../events/bus.js'

import { createDelegation } from '../services/delegations.js'
import { resolveDecision, getDecision } from '../services/decisions.js'
import { briefing } from '../data/seed.js'
import { memory } from '../memory/seed.js'
import { recall } from '../memory/recall.js'
import { HUMAN_ACCESS } from '../memory/fabric.js'
import { llm } from '../llm/index.js'
import { reason } from './reasoner.js'

// The "One Prompt" reasoning service (Vol 1 Ch 13 / Vol 3 Ch 14).
//
// SINGLE USER: the Deputy Chief (Products). There is no role gating here because there
// are no other roles. What this surface still cannot do is exceed the guardrails —
// the ₹10L autonomous limit and his own authority ceiling are enforced in the domain
// (services/decisions.ts), so the conversational path is not a way around them.
//
// Rules first (free, deterministic, unhallucinatable), model second (grounded).

export interface CommandResponse {
  reply: string
  chips?: string[]
  blocked?: boolean
  /** Present only when a model was actually called — so cost is never invisible. */
  meta?: { model: string; costUsd: number; latencyMs: number; grounded: boolean }
}

interface Intent {
  match: (q: string) => boolean
  run: (ctx: { store: Store; user: User; raw: string }) => CommandResponse
}

const has = (q: string, ...terms: string[]) => terms.some((t) => q.includes(t))

const INTENTS: Intent[] = [
  // Organizational Memory — placed FIRST so institutional questions are answered from
  // the memory fabric rather than falling through to today's telemetry.
  {
    match: (q) =>
      has(q, 'why did', 'why was', 'why we', 'lesson', 'learn', 'precedent', 'last time', 'history', 'remember', 'commit')
      || (has(q, 'what happened') && !has(q, 'today')),
    run: ({ raw }) => {
      const a = recall(memory, raw, HUMAN_ACCESS)
      let reply = a.answer
      if (a.lessons.length) reply += ` — Lesson on record: ${a.lessons.map((l) => l.rule).join(' ')}`
      if (a.gaps.length) reply += ` (Gap: ${a.gaps.join(' ')})`
      reply += ` [${a.basis.length} source${a.basis.length === 1 ? '' : 's'}, confidence ${a.confidence}]`
      return { reply, chips: ['Show memory', 'What lessons apply?'] }
    },
  },
  {
    match: (q) => has(q, 'brief', 'summary', 'whats up', "what's up"),
    run: () => ({
      reply: `Morning briefing: ${briefing.headline} ${briefing.bullets[0]} ${briefing.bullets[1]} Everything else is handled.`,
      chips: ['Delegate UPI issue', 'Show decisions', 'Review RBI note'],
    }),
  },
  {
    match: (q) => has(q, 'upi') && has(q, 'status', 'health', 'how'),
    run: () => ({
      reply:
        'UPI success rate is 97.1% (below the 99% threshold). Root cause: PSP "AxisPay" degradation (INC-4521, P2, VP – IT Operations, Mitigating). ' +
        'This is AxisPay\'s 3rd SLA breach this quarter — decision DT-009 is queued for you.',
      chips: ['Delegate UPI issue', 'Approve SLA notice'],
    }),
  },
  {
    match: (q) => has(q, 'channel', 'imps', 'neft', 'rtgs'),
    run: ({ store }) => ({
      reply: 'Channel health: ' + store.channels.map((c) => `${c.name} ${c.value} (${c.status})`).join(', ') + '. Only UPI is outside tolerance.',
      chips: ['UPI status'],
    }),
  },
  {
    match: (q) => has(q, 'delegate') && has(q, 'upi', '4521', 'latency'),
    run: ({ store, user }) => {
      try {
        const d = createDelegation(store, {
          user,
          delegate: 'VP – IT Operations',
          subject: 'Resolve UPI/AxisPay latency (INC-4521)',
          authorityLevel: 'L3',
          spendCapInr: 500_000,
          priority: 'High',
          deadline: '12:00 IST',
          context: 'INC-4521; SLA status; ~2.9% UPI txns slow',
        })
        return { reply: `Delegation ${d.id} sent to VP – IT Operations (L3, up to ₹5L, due 12:00). Context auto-attached; I'll escalate if the 10:00 checkpoint slips.`, chips: ['Show delegations'] }
      } catch (e) {
        return { reply: `Could not delegate: ${(e as Error).message}`, blocked: true }
      }
    },
  },
  {
    match: (q) => has(q, 'approve') && has(q, 'sla', 'dt-009', 'axispay'),
    run: (ctx) => approve(ctx, 'DT-009', 'formal SLA breach notice to AxisPay (₹1.2L withholding)'),
  },
  {
    match: (q) => has(q, 'approve') && has(q, 'cdn', 'renew', 'dt-007', 'akamai'),
    run: (ctx) => approve(ctx, 'DT-007', 'Akamai CDN renewal (₹1.2Cr)'),
  },
  {
    match: (q) => has(q, 'approve') && has(q, 'rbi', 'token', 'dt-010'),
    run: (ctx) => approve(ctx, 'DT-010', 'RBI tokenisation implementation plan'),
  },
  {
    match: (q) => has(q, 'decision'),
    run: ({ store }) => {
      const pending = store.decisions.filter((d) => d.status === 'pending')
      return {
        reply: `${pending.length} decisions await you: ` + pending.map((d) => `${d.id} (${d.tier}) ${d.type}`).join('; ') + '. Say "approve <id>".',
        chips: ['Approve SLA notice', 'Approve CDN renewal', 'Approve RBI plan'],
      }
    },
  },
  {
    match: (q) => has(q, 'delegation', 'who is working', 'follow up'),
    run: ({ store }) => ({
      reply: 'Active delegations: ' + store.delegations.map((d) => `${d.delegate} — "${d.subject}" (${d.status}, ${d.progress}%)`).join('; ') + '.',
    }),
  },
  {
    match: (q) => has(q, 'rbi', 'regulat', 'token'),
    run: () => ({
      reply: 'RBI/2026-27/44 (tokenisation): 90-day window; Compliance impact note flags 2 systems, ~6 sprints. Recommended: approve DT-010.',
      chips: ['Approve RBI plan'],
    }),
  },
  {
    match: (q) => has(q, 'draft', 'reply', 'email'),
    run: () => ({ reply: 'Drafted "UPI performance — status update" (INC-4521, 97.1%, ETA 12:00). In your Outlook drafts for review before send.' }),
  },
  {
    match: (q) => has(q, 'help', 'what can you'),
    run: () => ({
      reply: 'Try: "brief me", "UPI status", "delegate the UPI issue", "show decisions", "approve the SLA notice", "who is working on what", "draft a status update".',
      chips: ['Brief me', 'UPI status', 'Show decisions'],
    }),
  },
]

function approve(ctx: { store: Store; user: User }, id: string, label: string): CommandResponse {
  const { store, user } = ctx
  // No role check — one user. The guardrail that still bites is his own financial
  // authority ceiling, enforced inside resolveDecision.
  const item = getDecision(store, id)
  if (!item) return { reply: `Decision ${id} not found.`, blocked: true }
  if (item.status !== 'pending') return { reply: `${id} is already ${item.status}.` }
  try {
    resolveDecision(store, id, { decision: 'approved', user, rationale: `Approved via One Prompt` })
    const note = item.tier === 'Human-Required' ? ' Routing for four-eyes co-sign per the authority matrix.' : ''
    return { reply: `Approved ${id}: ${label}. Logged to the decision journal.${note}`, chips: ['Show decisions'] }
  } catch (e) {
    return { reply: `Blocked by guardrail: ${(e as Error).message}`, blocked: true }
  }
}

/**
 * Synchronous rule path. Known workflows are handled deterministically: free, instant,
 * auditable, and impossible to hallucinate. Returns null when nothing matches.
 */
export function runCommandSync(store: Store, user: User, raw: string): CommandResponse | null {
  const q = raw.trim().toLowerCase()
  if (!q) return { reply: 'Awaiting your command, Deputy Chief.' }
  const intent = INTENTS.find((i) => i.match(q))
  return intent ? intent.run({ store, user, raw }) : null
}

/**
 * The One Prompt entry point.
 *
 * Rules first (free, deterministic), model second (grounded). Most executive traffic hits
 * a rule — which is why $50 lasts. The model is spent only on the genuinely novel.
 */
export async function runCommand(store: Store, user: User, raw: string): Promise<CommandResponse> {
  let response = runCommandSync(store, user, raw)

  if (!response) {
    if (llm.isConfigured()) {
      try {
        const r = await reason(store, user, raw)
        response = {
          reply: r.reply,
          chips: ['Brief me', 'Show decisions'],
          meta: { model: r.model, costUsd: r.costUsd, latencyMs: r.latencyMs, grounded: true },
        }
      } catch (e) {
        const msg = (e as Error).message
        response = {
          reply: msg.includes('budget')
            ? `⚠ ${msg}`
            : `Reasoning unavailable: ${msg}`,
          blocked: true,
        }
      }
    } else {
      response = {
        reply: 'No LLM is configured, so I can only handle known workflows — and I will not guess. Set EIOS_LLM_BASE_URL to enable real reasoning. Type "help" for what I can do on rules alone.',
        chips: ['Help', 'Brief me'],
      }
    }
  }

  bus.publish(Events.CommandExecuted, {
    actor: user.name, actorRole: user.role, resource: 'one-prompt',
    detail: `"${raw}"${response.blocked ? ' [blocked]' : ''}${response.meta ? ` [model ${response.meta.model}, $${response.meta.costUsd.toFixed(5)}]` : ' [rule]'}`,
  })
  return response
}
