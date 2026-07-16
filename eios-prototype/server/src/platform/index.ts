import { EventStore, ensureDir } from './eventStore.js'
import { config } from '../config.js'

// Platform composition root.
//
// The event log is the system of record. Durability is ON by default — a knowledge
// platform that forgets on restart is not one. Set EIOS_EVENT_LOG=off for ephemeral runs
// (tests), which is explicit rather than accidental.

const durable = config.eventLog.path !== 'off'
if (durable) ensureDir(config.eventLog.path)

export const eventStore = new EventStore(
  durable
    ? { path: config.eventLog.path, snapshotPath: config.eventLog.snapshotPath }
    : {},
)

export { EventStore } from './eventStore.js'
export type { StoredEvent, Snapshot } from './eventStore.js'
export { replay, asOf, stateHash, verifyDeterminism, replayAgainstHistory } from './replay.js'
export type { ReplayResult, DeterminismReport } from './replay.js'
export { architectureScorecard } from './metrics.js'
export type { Scorecard, Metric } from './metrics.js'
export { feedback } from './feedback.js'
export type { AttentionFeedback, RecommendationFeedback } from './feedback.js'
