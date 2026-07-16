import { Router, type Request, type Response, type NextFunction } from 'express'
import { store } from '../data/store.js'
import { DEPUTY_CHIEF } from '../governance/rbac.js'
import { memory } from '../memory/seed.js'
import { recall } from '../memory/recall.js'
import { HUMAN_ACCESS } from '../memory/fabric.js'
import {
  knowledgeQuality, invalidationRisks, ancestry, descendants, explainLineage, wisdomEngine,
  knowledgeEvolution,
} from '../knowledge/index.js'
import { bus } from '../events/bus.js'
import { auditLog } from '../governance/audit.js'
import { config } from '../config.js'
import { authenticate } from './middleware.js'
import { listSignals, handleSignal } from '../services/signals.js'
import { listDecisions, resolveDecision, attemptAutoExecute } from '../services/decisions.js'
import { listDelegations, createDelegation, updateDelegation } from '../services/delegations.js'
import { runCommand } from '../cognitive/commandService.js'
import { aiProvider } from '../cognitive/aiProvider.js'
import { pulse } from '../twin/pulse.js'
import { perception } from '../perception/index.js'
import { validateEvent } from '../perception/events.js'
import {
  eventStore, verifyDeterminism, asOf, architectureScorecard, feedback,
} from '../platform/index.js'
import { llm, llmStatus } from '../llm/index.js'
import { parseEmails } from '../ingest/email.js'
import { triageBatch, toSignal, triageStats } from '../ingest/triage.js'

// wrap async handlers so thrown domain errors reach the error middleware
const h = (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next)

export const api = Router()

// --- health & identity ------------------------------------------------------
api.get('/health', (_req, res) => res.json({
  status: 'ok', aiProvider: aiProvider.name, autonomousLimitInr: config.autonomousFinancialLimitInr, auditEntries: auditLog.size(),
}))

/** Single user — kept so the UI can show who it is serving. */
api.get('/auth/users', (_req, res) => res.json([DEPUTY_CHIEF]))

api.use(authenticate)

api.get('/me', (req, res) => res.json({ user: req.user }))

// --- executive command center data -----------------------------------------
api.get('/overview', (_req, res) => res.json({
  executive: store.executive,
  briefing: store.briefing,
  kpis: store.kpis,
  channels: store.channels,
  incidents: store.incidents,
}))

api.get('/signals', (_req, res) => res.json(listSignals(store)))
api.post('/signals/:id/handle', h((req, res) => res.json(handleSignal(store, req.params.id, req.user!))))

api.get('/decisions', (_req, res) => res.json(listDecisions(store)))
api.post('/decisions/:id/resolve', h((req, res) => {
  const decision = req.body?.decision === 'rejected' ? 'rejected' : 'approved'
  // No role check — there is one user. The guardrail that still applies is his own
  // financial authority ceiling, enforced inside resolveDecision (ABAC).
  const item = resolveDecision(store, req.params.id, { decision, user: req.user!, rationale: req.body?.rationale })
  return res.json(item)
}))
api.post('/decisions/:id/auto-execute', h((req, res) => res.json(attemptAutoExecute(store, req.params.id))))

api.get('/delegations', (_req, res) => res.json(listDelegations(store)))
api.post('/delegations', h((req, res) => res.status(201).json(createDelegation(store, { user: req.user!, ...req.body }))))
api.patch('/delegations/:id', h((req, res) => res.json(updateDelegation(store, req.params.id, { ...req.body, actor: req.user! }))))

// --- cognitive -------------------------------------------------------------
api.get('/agents', (_req, res) => res.json(store.agents))
api.get('/knowledge-graph', (_req, res) => res.json(store.knowledgeGraph))

api.post('/command', h(async (req, res) => res.json(await runCommand(store, req.user!, String(req.body?.text ?? '')))))

// --- perception layer (the twin's only input) ------------------------------
api.get('/perception', (_req, res) => res.json({
  ...perception.report(),
  recentEvents: perception.recentEvents(20),
}))

/**
 * Ingestion endpoint — how real enterprise systems (Graph, DevOps, ServiceNow,
 * Azure Monitor, webhooks) push observations into the twin. Events are validated
 * and folded through the reducer; unknown entities are rejected, not invented.
 * Accepts one event or an array.
 */
api.post('/events', h((req, res) => {
  const raw = Array.isArray(req.body) ? req.body : [req.body]
  const accepted: string[] = []
  const errors: { index: number; error: string }[] = []
  raw.forEach((item, i) => {
    const parsed = validateEvent(item)
    if ('error' in parsed) { errors.push({ index: i, error: parsed.error }); return }
    if (perception.ingest(parsed)) {
      accepted.push(parsed.id)
      // Pushed events must accrete knowledge exactly as polled ones do — otherwise a
      // real system pushing an incident would update the twin but never be remembered.
      knowledgeEvolution.onEvent(parsed)
    } else {
      errors.push({ index: i, error: `unknown entityId '${parsed.entityId}' for kind '${parsed.kind}'` })
    }
  })
  // Re-run the offices immediately so ingestion is reflected without waiting a beat.
  if (accepted.length) pulse.beat(false)
  return res.status(errors.length && !accepted.length ? 400 : 202)
    .json({ accepted: accepted.length, rejected: errors.length, errors })
}))

// --- organizational twin & pulse (the operating-system core) ---------------
api.get('/pulse', (_req, res) => res.json(pulse.snapshot()))
api.get('/twin', (_req, res) => res.json(pulse.twin()))

// Server-Sent Events: the live heartbeat streamed to the UI (the "hospital monitor").
api.get('/pulse/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders?.()
  const send = (snap: unknown) => res.write(`data: ${JSON.stringify(snap)}\n\n`)
  send(pulse.snapshot())
  const unsubscribe = pulse.subscribe(send)
  req.on('close', () => { unsubscribe(); res.end() })
})

// --- organizational memory fabric ------------------------------------------
// SINGLE USER: the executive sees all of his own memory. The boundary that still exists
// is EGRESS — what may be put into a prompt bound for an external model.
api.get('/memory', (_req, res) => {
  const all = memory.all(HUMAN_ACCESS)
  const withheld = memory.llmWithheld()
  res.json({
    stats: memory.stats(),
    visible: all.length,
    /** Records that are never included in an LLM prompt (personal/restricted). */
    llmWithheld: withheld.length,
    llmWithheldNote: withheld.length
      ? `${withheld.length} record(s) are personal/restricted — you can read them; they are never sent to a model.`
      : 'No records are withheld from the model.',
    nodes: all.sort((a, b) => b.at.localeCompare(a.at)),
  })
})

api.get('/memory/lessons', (_req, res) =>
  res.json(memory.byKind('lesson', HUMAN_ACCESS)))

api.get('/memory/entity/:id', (req, res) => {
  const node = memory.get(req.params.id, HUMAN_ACCESS)
  if (!node) return res.status(404).json({ error: `No memory record '${req.params.id}'` })
  return res.json({
    node,
    related: memory.neighbors(req.params.id, undefined, HUMAN_ACCESS),
    trace: memory.trace(req.params.id, HUMAN_ACCESS),
    /** Honest: would this record be placed in a prompt, or held on this machine? */
    sentToLlm: node.sensitivity === 'open',
  })
})

api.get('/memory/timeline/:entityRef', (req, res) =>
  res.json(memory.timeline(req.params.entityRef, HUMAN_ACCESS)))

/** Executive recall — structured, provenance-traced, honest about gaps. No LLM. */
api.post('/memory/recall', h((req, res) =>
  res.json(recall(memory, String(req.body?.question ?? ''), HUMAN_ACCESS))))

// --- Executive Knowledge Platform -----------------------------------------
/** The system's assessment of its OWN reliability. */
api.get('/knowledge/quality', (_req, res) =>
  res.json(knowledgeQuality(memory, HUMAN_ACCESS)))

/** Conclusions resting on foundations that have since moved. */
api.get('/knowledge/risks', (_req, res) =>
  res.json(invalidationRisks(memory, HUMAN_ACCESS)))

/** Decision lineage — why this exists. */
api.get('/knowledge/lineage/:id', (req, res) => {
  const ctx = HUMAN_ACCESS
  if (!memory.get(req.params.id, ctx)) return res.status(404).json({ error: `No visible record '${req.params.id}'` })
  return res.json({
    explanation: explainLineage(memory, req.params.id, ctx),
    ancestry: ancestry(memory, req.params.id, ctx),
    descendants: descendants(memory, req.params.id, ctx),
  })
})

/** Candidate wisdom awaiting human approval — the system proposes, a human disposes. */
api.get('/knowledge/wisdom/candidates', (_req, res) =>
  res.json(wisdomEngine.list()))

/**
 * Promote a candidate to organizational wisdom. Deliberately gated on decision:approve —
 * setting organizational policy is an executive act, not a memory read.
 */
api.post('/knowledge/wisdom/:id/approve', h((req, res) => {
  const result = wisdomEngine.approve(memory, req.params.id, req.user!.name, req.body?.rule)
  if ('error' in result) return res.status(404).json(result)
  bus.publish('knowledge.wisdom_approved', {
    actor: req.user!.name, actorRole: req.user!.role, resource: result.id,
    detail: `Promoted to organizational wisdom: ${result.rule}`,
  })
  return res.status(201).json(result)
}))

api.post('/knowledge/wisdom/:id/reject', h((req, res) => {
  const ok = wisdomEngine.reject(req.params.id, req.user!.name)
  return ok ? res.json({ rejected: req.params.id }) : res.status(404).json({ error: 'No such candidate' })
}))

// --- PHASE 2: platform (event log · replay · time travel · scorecard) ------
api.get('/platform/log', (req, res) => res.json({
  ...eventStore.stats(),
  events: eventStore.read({ from: Number(req.query.from ?? 1) }).slice(-Number(req.query.limit ?? 50)),
}))

/** Replay determinism — same history must reconstruct the same organization. */
api.get('/platform/determinism', (_req, res) =>
  res.json(verifyDeterminism(eventStore)))

/**
 * TIME TRAVEL — "show me the organization as it was on 14 March 2026."
 * Returns the reconstructed state, not a report about it.
 */
api.get('/platform/as-of/:timestamp', h((req, res) => {
  const ts = req.params.timestamp
  if (Number.isNaN(new Date(ts).getTime())) {
    return res.status(400).json({ error: `Invalid timestamp '${ts}' — use an ISO date.` })
  }
  const r = asOf(eventStore, ts)
  return res.json({
    asOf: ts, eventsApplied: r.eventsApplied, throughSeq: r.throughSeq,
    stateHash: r.hash, durationMs: r.durationMs, twin: r.twin,
  })
}))

/**
 * ARCHITECTURE SCORECARD — the measure of success. Not test count.
 * Metrics that cannot be honestly computed report `measurable: false` with the reason.
 */
api.get('/platform/scorecard', (_req, res) =>
  res.json(architectureScorecard({
    store: eventStore,
    memory,
    decisions: listDecisions(store),
    twinFreshnessSamples: perception.freshnessSamples(),
  })))

/** Executive feedback — the only thing that makes attention precision real. */
api.post('/attention/:id/feedback', h((req, res) => {
  const neededExecutive = Boolean(req.body?.neededExecutive)
  const snap = pulse.snapshot()
  const item = [...snap.attention.forExecutive, ...snap.attention.delegated].find((a) => a.id === req.params.id)
  if (!item) return res.status(404).json({ error: `No attention item '${req.params.id}' in the current pulse` })
  return res.status(201).json(feedback.recordAttention({
    itemId: item.id, office: item.office, title: item.title,
    neededExecutive, by: req.user!.name,
  }))
}))

// --- LLM: reasoning + cost -------------------------------------------------
/** Is real reasoning on, and what has it cost? Never let spend be invisible. */
api.get('/llm/status', (_req, res) => res.json(llmStatus()))

api.get('/llm/cost', (_req, res) => res.json({
  ...llm.ledger.report(),
  recentCalls: llm.ledger.history(20),
}))

// --- Email triage: the real workflow, on your own exported mail ------------
/**
 * POST /api/ingest/email
 * Body: raw export (text/plain .eml/.mbox/.csv, or application/json array).
 * Query: ?filename=inbox.mbox&limit=50&dryRun=true
 *
 * Needs NO admin consent: you export mail you already have the right to read.
 * PII is redacted before anything leaves this machine.
 */
api.post('/ingest/email', h(async (req, res) => {
  const filename = String(req.query.filename ?? '')
  const limit = Math.min(Number(req.query.limit ?? 50), 200) // cap: tokens are money
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)

  let emails
  try {
    emails = parseEmails(raw, filename)
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message })
  }

  const capped = emails.slice(0, limit)
  if (req.query.dryRun === 'true') {
    // Parse-only: prove the export reads correctly before spending a rupee.
    return res.json({
      dryRun: true, parsed: emails.length, wouldTriage: capped.length,
      estimatedCostUsd: Number((capped.length * 0.00017).toFixed(4)),
      sample: capped.slice(0, 3).map((e) => ({ from: e.from, subject: e.subject, bodyPreview: e.body.slice(0, 120) })),
    })
  }

  if (!llm.isConfigured()) {
    return res.status(503).json({
      error: 'No LLM configured — triage needs a real model. Set EIOS_LLM_BASE_URL. Use ?dryRun=true to verify parsing without a model.',
      parsed: emails.length,
    })
  }

  try {
    const { results, errors, totalCostUsd } = await triageBatch(capped)
    // Real triaged mail replaces the demo signals — the queue becomes YOUR inbox.
    store.signals = results.map(toSignal)
    pulse.beat(false)
    return res.json({
      parsed: emails.length,
      triaged: results.length,
      errors,
      totalCostUsd,
      stats: triageStats(results),
      budget: llm.ledger.report(),
      results: results.map((r) => ({
        id: r.email.id, from: r.email.from, subject: r.email.subject,
        ...r.verdict, redaction: r.redaction, costUsd: r.costUsd,
      })),
    })
  } catch (e) {
    return res.status(402).json({ error: (e as Error).message, budget: llm.ledger.report() })
  }
}))

// --- governance ------------------------------------------------------------
api.get('/audit', (req, res) => res.json({
  integrity: auditLog.verify(),
  events: auditLog.list(Number(req.query.limit ?? 200)),
}))
