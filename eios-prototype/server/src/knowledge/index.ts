import { memory } from '../memory/seed.js'
import { KnowledgeEvolution } from './evolution.js'

// Executive Knowledge Platform v1 — the composition root.
//
// The platform's contract with everything downstream (Offices, Attention, a future
// Executive Brain): knowledge is structured, lifecycle-aware, provenance-carrying,
// confidence-explained, governed, and continuously evolving. Reasoning engines can be
// swapped forever; this layer is what they must be able to rely on.

export const knowledgeEvolution = new KnowledgeEvolution(memory)

export { computeConfidence, statedFactConfidence, band } from './confidence.js'
export { ageNode, refreshNode, supersede, validityOf, breakAssumption, freshnessOf } from './lifecycle.js'
export { ancestry, descendants, invalidationRisks, explainLineage } from './lineage.js'
export { wisdomEngine, resembles, detectPatterns } from './wisdom.js'
export { knowledgeQuality } from './quality.js'
export type { QualityReport } from './quality.js'
export type { EvolutionResult } from './evolution.js'
