// EIOS in-memory Store — the Command Center's mutable working set.
//
// PROVENANCE: like `seed.ts`, this file lives under `server/src/data/`, which the repo
// `.gitignore` excludes via the `data/` rule (meant for the runtime event log). It was
// therefore never committed. Reconstructed from its consumers — `api/routes.ts`,
// `services/*`, `cognitive/*` — and the test suites.
//
// This is deliberately NOT the system of record. The durable history is the event log
// (`platform/eventStore.ts`); the memory fabric is `memory/*`; the live twin is
// `perception`/`pulse`. The Store holds the operational entities the Executive Command
// Center reads and mutates directly: signals, decisions, delegations, and the reference
// data behind the overview (executive, briefing, KPIs, channels, incidents, agents,
// knowledge graph).
//
// SINGLE USER: one executive, one Store. The exported `store` singleton is what the API
// uses. The tests construct their own `new Store()` instances and mutate them, so the
// constructor must hand each caller an INDEPENDENT deep copy of the seed — never shared
// references — or one test would leak state into the next.

import type {
  Agent, ChannelHealth, DecisionItem, Delegation, Incident, KgEdge, KgNode, Kpi, Signal, User,
} from '../domain/types.js'
import { DEPUTY_CHIEF } from '../governance/rbac.js'
import * as seed from './seed.js'

const clone = <T>(value: T): T => structuredClone(value)

export class Store {
  /** The one executive this system serves (Vol 7 identity). */
  executive: User = clone(DEPUTY_CHIEF)
  /** Morning briefing shown on the overview and by the "brief me" intent. */
  briefing: seed.Briefing = clone(seed.briefing)

  kpis: Kpi[] = clone(seed.kpis)
  channels: ChannelHealth[] = clone(seed.channels)
  incidents: Incident[] = clone(seed.incidents)

  /** Attention queue. Reassigned wholesale when real mail is triaged in (see routes). */
  signals: Signal[] = clone(seed.signals)
  /** Pending/resolved executive decisions. Mutated in place by services/decisions.ts. */
  decisions: DecisionItem[] = clone(seed.decisions)
  /** Active delegations. Mutated in place by services/delegations.ts. */
  delegations: Delegation[] = clone(seed.delegations)

  agents: Agent[] = clone(seed.agents)
  knowledgeGraph: { nodes: KgNode[]; edges: KgEdge[] } = clone(seed.knowledgeGraph)
}

/** The process-wide Store used by the API. One user, one instance. */
export const store = new Store()
