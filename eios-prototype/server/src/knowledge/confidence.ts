import type { Confidence } from '../memory/model.js'

// Multidimensional confidence.
//
// "Confidence = 0.92" is useless to an executive — it hides WHY. This module computes an
// overall score AND names the dimension holding it down, so the executive knows what to
// fix ("the estimate is 4 months old" is actionable; "0.62" is not).
//
// Deliberately NOT a plain average: a weighted mean lets one strong dimension mask a fatal
// one. A recommendation with excellent reasoning built on 4-month-old data is not "pretty
// good" — it is limited by its data. So `overall` is capped near the weakest dimension.

export interface ConfidenceInput {
  evidence?: number
  reasoning?: number
  policy?: number
  freshness?: number
  humanValidation?: Confidence['humanValidation']
}

const WEIGHTS = { evidence: 0.3, reasoning: 0.25, policy: 0.25, freshness: 0.2 }

/** Ceilings imposed by human validation state, regardless of the other dimensions. */
const VALIDATION_CAP: Record<Confidence['humanValidation'], number> = {
  validated: 1.0,
  unvalidated: 0.85, // nothing unreviewed should read as near-certain
  disputed: 0.4,     // an active dispute dominates everything else
}

const LABEL: Record<string, string> = {
  evidence: 'evidence quality',
  reasoning: 'reasoning soundness',
  policy: 'policy validation',
  freshness: 'data freshness',
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function computeConfidence(input: ConfidenceInput): Confidence {
  const evidence = clamp01(input.evidence ?? 0.7)
  const reasoning = clamp01(input.reasoning ?? 0.7)
  const policy = clamp01(input.policy ?? 0.7)
  const freshness = clamp01(input.freshness ?? 0.7)
  const humanValidation = input.humanValidation ?? 'unvalidated'

  const dims = { evidence, reasoning, policy, freshness }
  const weighted =
    evidence * WEIGHTS.evidence + reasoning * WEIGHTS.reasoning +
    policy * WEIGHTS.policy + freshness * WEIGHTS.freshness

  // Weakest-link dominance: you cannot average your way out of a bad dimension.
  const weakestName = (Object.keys(dims) as (keyof typeof dims)[])
    .reduce((a, b) => (dims[a] <= dims[b] ? a : b))
  const weakest = dims[weakestName]
  const capNearWeakest = weakest + 0.15

  const validationCap = VALIDATION_CAP[humanValidation]
  const overall = clamp01(Math.min(weighted, capNearWeakest, validationCap))

  // Name what is actually holding it down — that is the actionable output.
  let limitedBy: string
  if (overall === validationCap && validationCap < capNearWeakest && validationCap < weighted) {
    limitedBy = humanValidation === 'disputed' ? 'an active dispute' : 'lack of human validation'
  } else if (overall <= capNearWeakest && weakest < 0.75) {
    limitedBy = LABEL[weakestName]
  } else {
    limitedBy = 'nothing material — all dimensions are strong'
  }

  const explanation =
    `Overall ${(overall * 100).toFixed(0)}% — limited by ${limitedBy}. ` +
    `evidence ${(evidence * 100).toFixed(0)}%, reasoning ${(reasoning * 100).toFixed(0)}%, ` +
    `policy ${(policy * 100).toFixed(0)}%, freshness ${(freshness * 100).toFixed(0)}%, ` +
    `human validation: ${humanValidation}.`

  return { evidence, reasoning, policy, freshness, humanValidation, overall, limitedBy, explanation }
}

/** Default for a plainly-recorded fact from a trusted source. */
export function statedFactConfidence(): Confidence {
  return computeConfidence({ evidence: 0.95, reasoning: 0.9, policy: 0.85, freshness: 0.9, humanValidation: 'validated' })
}

/** Coarse band for UI/summary use — never a substitute for the detail. */
export function band(c: Confidence): 'high' | 'medium' | 'low' {
  return c.overall >= 0.75 ? 'high' : c.overall >= 0.5 ? 'medium' : 'low'
}
