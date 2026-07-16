import type { MemoryFabric, AccessContext } from './fabric.js'
import type {
  RecallAnswer, BasisItem, DecisionMemory, MeetingMemory, LessonMemory, AnyMemory,
} from './model.js'
import { validityOf } from '../knowledge/lifecycle.js'
import { ancestry } from '../knowledge/lineage.js'
import { band } from '../knowledge/confidence.js'

// The Recall Engine.
//
// THE THESIS: answering "Why did we reject XYZ Bank's proposal?" well requires MEMORY,
// not a bigger model. This engine uses NO LLM. It locates an entry point (lexical aid),
// then traverses the structured graph and assembles the answer from records — every
// claim carrying its provenance. An LLM would only make the prose nicer; it cannot
// supply the institutional facts, and if the facts are absent it would invent them.
//
// It also reports what it does NOT know (`gaps`) and what it withheld (`redactions`).

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })

const basis = (n: AnyMemory, fact: string): BasisItem =>
  ({ nodeId: n.id, fact, provenance: n.provenance, lifecycle: n.lifecycle })

/** Executive-layer judgment that applies to this topic (distinct from org facts). */
const judgmentsFor = (fabric: MemoryFabric, tags: string[], ctx: AccessContext) =>
  fabric.judgmentsFor(tags, ctx).map((j) => ({ id: j.id, trigger: j.trigger, judgment: j.judgment, because: j.because }))

export function recall(fabric: MemoryFabric, question: string, ctx: AccessContext): RecallAnswer {
  const q = question.toLowerCase()
  const hits = fabric.search(question, ctx, 6)
  const redactedCount = fabric.countRedacted(fabric.all({ canSeePersonal: true, canSeeRestricted: true }), ctx)
  const redactions = {
    count: redactedCount,
    reason: redactedCount
      ? 'Records classified personal/restricted are withheld from this role (People Memory governance).'
      : 'None.',
  }

  // --- "Why did we <decide/reject/approve> X?" → Decision recall ------------
  const wantsWhy = /\bwhy\b/.test(q) || /\breject|approve|decide|decision\b/.test(q)
  const decision = hits.find((h): h is DecisionMemory => h.kind === 'decision')
  if (wantsWhy && decision) {
    return decisionRecall(fabric, question, decision, ctx, redactions)
  }

  // --- "What did we learn / lessons" → organizational wisdom ---------------
  if (/\blesson|learn|scar|wisdom|never\b/.test(q)) {
    const lessons = fabric.byKind<LessonMemory>('lesson', ctx).filter((l) => l.active)
    const relevant = hits.length ? fabric.lessonsFor(hits.flatMap((h) => h.tags), ctx) : []
    const use = relevant.length ? relevant : lessons
    return {
      question,
      answer: use.length
        ? `The organization carries ${use.length} active lesson${use.length > 1 ? 's' : ''} here. ` +
          use.map((l) => `${l.rule} (learned the hard way: ${l.scar})`).join(' ')
        : 'No lessons recorded for that.',
      basis: use.map((l) => basis(l, l.rule)),
      timeline: use.map((l) => ({ at: l.at, what: l.title, nodeId: l.id })),
      lessons: use.map((l) => ({ id: l.id, rule: l.rule, scar: l.scar })),
      judgments: judgmentsFor(fabric, use.flatMap((l) => l.tags), ctx),
      confidence: use.length ? 'high' : 'low',
      gaps: use.length ? [] : ['No lesson records matched this topic.'],
      redactions,
    }
  }

  // --- "What happened with X?" → causal trace -----------------------------
  if (/\bhappen|outage|incident|delay|churn|escalat\b/.test(q) && hits.length) {
    const start = hits[0]
    const chain = fabric.trace(start.id, ctx)
    const lessons = fabric.lessonsFor(chain.flatMap((c) => c.tags), ctx)
    return {
      question,
      answer: chain.length > 1
        ? `${chain.map((c) => c.title).join(' → ')}.` +
          (lessons.length ? ` The organization's rule since: ${lessons.map((l) => l.rule).join(' ')}` : '')
        : start.summary,
      basis: chain.map((c) => basis(c, c.summary)),
      timeline: chain.map((c) => ({ at: c.at, what: c.title, nodeId: c.id })),
      lessons: lessons.map((l) => ({ id: l.id, rule: l.rule, scar: l.scar })),
      judgments: judgmentsFor(fabric, chain.flatMap((c) => c.tags), ctx),
      confidence: chain.length > 1 ? 'high' : 'medium',
      gaps: chain.length > 1 ? [] : ['Only a single record found — the downstream consequences may not be captured.'],
      redactions,
    }
  }

  // --- "What did I commit to?" → commitments ------------------------------
  if (/\bcommit|promise|said|owe|follow.?up\b/.test(q)) {
    const meetings = fabric.byKind<MeetingMemory>('meeting', ctx)
    const decisions = fabric.byKind<DecisionMemory>('decision', ctx)
    const items: BasisItem[] = []
    const lines: string[] = []
    for (const m of meetings) {
      for (const c of m.commitments.filter((x) => x.status === 'open')) {
        lines.push(`${c.who}: "${c.text}" (open, from ${m.title})`)
        items.push(basis(m, `${c.who} committed: ${c.text}`))
      }
    }
    for (const d of decisions) {
      for (const c of d.commitments) {
        lines.push(`${c.who}: "${c.text}"${c.condition ? ` — conditional on: ${c.condition}` : ''} (${d.id})`)
        items.push(basis(d, `${c.who} committed: ${c.text}`))
      }
    }
    return {
      question,
      answer: lines.length ? `Open commitments on record: ${lines.join('; ')}.` : 'No open commitments on record.',
      basis: items,
      timeline: [],
      lessons: [],
      judgments: [],
      confidence: lines.length ? 'high' : 'low',
      gaps: lines.length ? [] : ['No commitment records matched.'],
      redactions,
    }
  }

  // --- Fallback: entry-point search + timeline ----------------------------
  if (!hits.length) {
    return {
      question,
      answer: "Memory has no record of that. I won't guess — nothing in the fabric matches.",
      basis: [], timeline: [], lessons: [], judgments: [],
      confidence: 'low',
      gaps: ['No matching records. Either it predates the memory fabric, or it was never captured.'],
      redactions,
    }
  }
  const top = hits[0]
  return {
    question,
    answer: `${top.title} (${fmtDate(top.at)}). ${top.summary}`,
    basis: hits.map((h) => basis(h, h.summary)),
    timeline: hits.map((h) => ({ at: h.at, what: h.title, nodeId: h.id })).sort((a, b) => a.at.localeCompare(b.at)),
    lessons: fabric.lessonsFor(top.tags, ctx).map((l) => ({ id: l.id, rule: l.rule, scar: l.scar })),
    judgments: judgmentsFor(fabric, top.tags, ctx),
    confidence: band(top.confidence),
    confidenceDetail: top.confidence,
    gaps: top.lifecycle === 'stale' ? [`Primary record "${top.title}" is stale — past its verification window.`] : [],
    redactions,
  }
}

/**
 * The flagship path. Assembles rationale, alternatives, the blocking approval gap,
 * the executive's own words, and the revisit condition — then checks whether that
 * condition has since been met. That last step is what makes it *executive* memory
 * rather than an archive.
 */
function decisionRecall(
  fabric: MemoryFabric,
  question: string,
  d: DecisionMemory,
  ctx: AccessContext,
  redactions: RecallAnswer['redactions'],
): RecallAnswer {
  const items: BasisItem[] = [basis(d, `${d.outcome} on ${fmtDate(d.at)}`)]
  const parts: string[] = [`${fmtDate(d.at)} — Decision ${d.id}: ${d.title}.`]

  parts.push(`Rejected because: ${d.rationale.join(' → ')}.`)
  d.rationale.forEach((r) => items.push(basis(d, r)))

  // Evidence nodes that fed the decision.
  const evidence = fabric.all(ctx).filter((n) =>
    fabric.neighbors(n.id, 'evidence_for', ctx).some((x) => x.node.id === d.id))
  evidence.forEach((e) => items.push(basis(e, e.summary)))

  const blocking = d.approvals.filter((a) => !a.given)
  if (blocking.length) {
    parts.push(`Blocking gap: ${blocking.map((a) => `${a.who} approval absent${a.note ? ` (${a.note})` : ''}`).join('; ')}.`)
  }

  if (d.alternatives.length) {
    parts.push(`Alternatives considered: ${d.alternatives.map((a) => `${a.option} — not taken: ${a.whyNot}`).join('; ')}.`)
    d.alternatives.forEach((a) => items.push(basis(d, `Alternative: ${a.option} — ${a.whyNot}`)))
  }

  // The executive's own words — the thing minutes lose and people misremember.
  const meeting = fabric.neighbors(d.id, 'decided_in', ctx)[0]?.node as MeetingMemory | undefined
  for (const c of d.commitments) {
    parts.push(`${c.who} said: "${c.text}"${c.condition ? ` — conditional on: ${c.condition}` : ''}`)
    items.push(basis(meeting ?? d, `${c.who} committed: ${c.text}`))
  }

  // Has the revisit condition since been met? Memory should volunteer this.
  const gaps: string[] = []
  if (d.revisitWhen) {
    const condition = fabric.search(d.revisitWhen, ctx, 3)
      .find((n) => n.kind === 'strategic' && n.id !== d.id)
    if (condition) {
      parts.push(`Revisit condition — "${d.revisitWhen}": ${condition.summary}`)
      items.push(basis(condition, condition.summary))
    } else {
      gaps.push(`Revisit condition "${d.revisitWhen}" — memory holds no record of whether it has been met.`)
    }
  }

  // TEMPORAL VALIDITY — the decision was right when made; is it still load-bearing?
  // A decision log stops at "we rejected it". Executive memory says "and one of the
  // beliefs it rested on has since broken — you should look again."
  const validity = validityOf(d)
  if (validity.state !== 'holds') {
    parts.push(
      `⚠ Current validity: ${validity.state.toUpperCase()}.` +
      (validity.brokenAssumptions.length
        ? ` The decision rested on assumptions that have since broken: ${validity.brokenAssumptions.join('; ')}.`
        : ' Assumptions underneath it are unverified.'),
    )
    validity.brokenAssumptions.forEach((a) => items.push(basis(d, `Broken assumption: ${a}`)))
  }
  const unverified = d.assumptions.filter((a) => a.status === 'unverified')
  if (unverified.length) {
    gaps.push(`${unverified.length} assumption(s) never verified: ${unverified.map((a) => a.text).join('; ')}.`)
  }

  // LINEAGE — why this decision exists, and whether its foundations moved.
  const lineage = ancestry(fabric, d.id, ctx)
  const movedFoundations = lineage.filter((l) => l.lifecycle === 'superseded' || l.lifecycle === 'obsolete')
  if (movedFoundations.length) {
    parts.push(`⚠ Lineage: rests on ${movedFoundations.map((l) => `"${l.title}" [${l.lifecycle}]`).join(', ')} — foundation has moved.`)
  }

  return {
    question,
    answer: parts.join(' '),
    basis: items,
    timeline: [
      ...evidence.map((e) => ({ at: e.at, what: e.title, nodeId: e.id })),
      { at: d.at, what: `${d.title} (${d.outcome})`, nodeId: d.id },
    ].sort((a, b) => a.at.localeCompare(b.at)),
    lessons: fabric.lessonsFor(d.tags, ctx).map((l) => ({ id: l.id, rule: l.rule, scar: l.scar })),
    judgments: judgmentsFor(fabric, d.tags, ctx),
    confidence: band(d.confidence),
    confidenceDetail: d.confidence,
    validity,
    lineage: lineage.map((l) => ({ id: l.id, title: l.title, lifecycle: l.lifecycle })),
    gaps,
    redactions,
  }
}
