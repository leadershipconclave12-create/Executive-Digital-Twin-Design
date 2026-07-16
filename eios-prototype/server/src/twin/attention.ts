import type { Observation, AttentionItem, Disposition } from './model.js'

// The Executive Attention Engine — the feature the platform version never had.
// The executive has ~8 hours; the org emits hundreds of signals. This engine
// decides where those hours go: the few things that truly need the executive,
// what can be delegated (with an owner), and what EIOS simply handles silently.

const DELEGATE_OWNER: Record<string, string> = {
  delivery: 'VP – Application Dev',
  engineering: 'VP – Application Dev',
  people: 'Chief of Staff',
  customer: 'VP – Digital Banking',
  risk: 'VP – IT Operations',
  operations: 'VP – IT Operations',
  strategy: 'Chief of Staff',
  'executive-intelligence': 'Chief of Staff',
}

export interface AttentionResult {
  forExecutive: AttentionItem[]
  delegated: AttentionItem[]
  handledCount: number
  hoursReclaimed: number
}

/**
 * Rank all observations by score = materiality × urgency, then triage:
 *  - top items above the executive bar → the executive's attention (capped, default 3)
 *  - clearly-owned mid items → delegated
 *  - everything else → handled silently
 */
export function optimizeAttention(observations: Observation[], execCap = 3): AttentionResult {
  const scored: AttentionItem[] = observations
    .map((o) => ({
      id: o.id,
      office: o.office,
      title: o.title,
      why: o.detail,
      score: Number((o.materiality * o.urgency).toFixed(3)),
      disposition: 'handled' as Disposition,
      recommendedAction: recommend(o),
      delegateTo: DELEGATE_OWNER[o.office],
    }))
    .sort((a, b) => b.score - a.score)

  const forExecutive: AttentionItem[] = []
  const delegated: AttentionItem[] = []
  let handledCount = 0

  for (const item of scored) {
    if (forExecutive.length < execCap && item.score >= 0.45) {
      item.disposition = 'executive'
      forExecutive.push(item)
    } else if (item.score >= 0.2) {
      item.disposition = 'delegated'
      delegated.push(item)
    } else {
      handledCount += 1
    }
  }

  // Rough model of reclaimed executive time: each delegated/handled item is work
  // the executive would otherwise have triaged manually (~6 min each).
  const hoursReclaimed = Number(((delegated.length + handledCount) * 0.1).toFixed(1))

  return { forExecutive, delegated, handledCount, hoursReclaimed }
}

function recommend(o: Observation): string {
  switch (o.office) {
    case 'delivery': return 'Rebalance capacity / decide on scope'
    case 'engineering': return 'Pre-brief a go/no-go'
    case 'risk': return o.title.includes('renewal') ? 'Decide renewal vs RFP' : 'Issue SLA notice'
    case 'customer': return 'Approve merchant comms plan'
    case 'operations': return 'Track mitigation; escalate if breach risk'
    case 'strategy': return 'Approve roadmap change'
    case 'people': return '1:1 check-in; rebalance load'
    default: return 'Review'
  }
}
