import type { MemoryFabric, AccessContext } from '../memory/fabric.js'
import { OPEN_ACCESS } from '../memory/fabric.js'
import type { MemoryKind } from '../memory/model.js'
import { invalidationRisks } from './lineage.js'

// Knowledge Quality Scoring.
//
// A knowledge platform that cannot assess its OWN reliability will mislead confidently.
// This is the meta-layer: the system reporting which parts of its institutional knowledge
// are trustworthy, stale, unvalidated, disputed, or resting on foundations that moved.
//
// This is what lets a future reasoning engine weight its inputs — and lets a human know
// when the answer deserves a second look.

export interface QualityReport {
  /** 0-100. Deliberately conservative — see `weakestArea`. */
  overall: number
  totals: {
    records: number
    trustworthy: number
    stale: number
    unvalidated: number
    disputed: number
    awaitingValidation: number
    superseded: number
    obsolete: number
    restingOnMovedFoundations: number
  }
  byKind: Record<string, { count: number; avgConfidence: number; stale: number }>
  /** The single most useful sentence in the report. */
  weakestArea: string
  recommendations: string[]
}

export function knowledgeQuality(fabric: MemoryFabric, ctx: AccessContext = OPEN_ACCESS): QualityReport {
  const all = fabric.all(ctx)
  const records = all.length
  if (!records) {
    return {
      overall: 0,
      totals: { records: 0, trustworthy: 0, stale: 0, unvalidated: 0, disputed: 0, awaitingValidation: 0, superseded: 0, obsolete: 0, restingOnMovedFoundations: 0 },
      byKind: {}, weakestArea: 'Knowledge base is empty.', recommendations: ['Seed or capture knowledge.'],
    }
  }

  const active = all.filter((n) => n.lifecycle === 'active')
  const stale = all.filter((n) => n.lifecycle === 'stale')
  const superseded = all.filter((n) => n.lifecycle === 'superseded')
  const obsolete = all.filter((n) => n.lifecycle === 'obsolete')
  const awaiting = all.filter((n) => n.lifecycle === 'awaiting_validation')
  const unvalidated = all.filter((n) => n.confidence.humanValidation === 'unvalidated')
  const disputed = all.filter((n) => n.confidence.humanValidation === 'disputed')
  const trustworthy = active.filter((n) => n.confidence.overall >= 0.75 && n.confidence.humanValidation !== 'disputed')
  const risks = invalidationRisks(fabric, ctx)

  const byKind: QualityReport['byKind'] = {}
  for (const n of all) {
    const k = n.kind as MemoryKind
    const e = byKind[k] ?? { count: 0, avgConfidence: 0, stale: 0 }
    e.avgConfidence = (e.avgConfidence * e.count + n.confidence.overall) / (e.count + 1)
    e.count += 1
    if (n.lifecycle === 'stale') e.stale += 1
    byKind[k] = e
  }
  for (const k of Object.keys(byKind)) byKind[k].avgConfidence = Number(byKind[k].avgConfidence.toFixed(3))

  // Conservative composite: coverage of trustworthy knowledge, penalised for decay,
  // disputes, and conclusions resting on moved foundations.
  const trustRatio = trustworthy.length / records
  const staleRatio = stale.length / records
  const disputeRatio = disputed.length / records
  const riskRatio = Math.min(1, risks.length / records)
  const overall = Math.round(
    Math.max(0, Math.min(1,
      trustRatio - staleRatio * 0.5 - disputeRatio * 0.8 - riskRatio * 0.4,
    )) * 100,
  )

  // Name the weakest area — the actionable output.
  const candidates: { label: string; severity: number }[] = [
    { label: `${disputed.length} disputed record(s) — contradictions unresolved`, severity: disputeRatio * 0.8 },
    { label: `${stale.length} stale record(s) past their verification window`, severity: staleRatio * 0.5 },
    { label: `${risks.length} conclusion(s) resting on superseded/obsolete foundations`, severity: riskRatio * 0.4 },
    { label: `${unvalidated.length} record(s) never validated by a human`, severity: (unvalidated.length / records) * 0.3 },
  ].sort((a, b) => b.severity - a.severity)
  const weakestArea = candidates[0].severity > 0.01
    ? candidates[0].label
    : 'No material weakness — knowledge is current and validated.'

  const recommendations: string[] = []
  if (disputed.length) recommendations.push(`Resolve ${disputed.length} contradiction(s) — disputed knowledge caps confidence at 40%.`)
  if (risks.length) recommendations.push(`Review ${risks.length} record(s) whose lineage ancestor was superseded.`)
  if (stale.length) recommendations.push(`Re-verify ${stale.length} stale record(s).`)
  if (awaiting.length) recommendations.push(`${awaiting.length} candidate lesson(s) awaiting human approval.`)
  if (!recommendations.length) recommendations.push('No action required.')

  return {
    overall,
    totals: {
      records,
      trustworthy: trustworthy.length,
      stale: stale.length,
      unvalidated: unvalidated.length,
      disputed: disputed.length,
      awaitingValidation: awaiting.length,
      superseded: superseded.length,
      obsolete: obsolete.length,
      restingOnMovedFoundations: risks.length,
    },
    byKind,
    weakestArea,
    recommendations,
  }
}
