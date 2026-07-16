import { bus } from '../events/bus.js'

// Executive feedback capture.
//
// Attention precision and false-escalation rate are only real if the executive tells us
// whether a surfaced item actually deserved them. Without this, those metrics are
// aspirations dressed as numbers. This is deliberately the smallest thing that makes
// them measurable — a judgement, an actor, a timestamp. Nothing more.

export interface AttentionFeedback {
  itemId: string
  office: string
  title: string
  /** The only question that matters: did this actually need the executive? */
  neededExecutive: boolean
  by: string
  at: string
}

export interface RecommendationFeedback {
  decisionId: string
  outcome: 'accepted' | 'modified' | 'rejected'
  by: string
  at: string
}

class FeedbackLedger {
  private attention: AttentionFeedback[] = []
  private recommendations: RecommendationFeedback[] = []

  recordAttention(f: Omit<AttentionFeedback, 'at'>): AttentionFeedback {
    const entry = { ...f, at: new Date().toISOString() }
    this.attention.push(entry)
    bus.publish('feedback.attention', {
      actor: f.by, actorRole: 'system', resource: f.itemId,
      detail: `${f.neededExecutive ? 'needed executive' : 'FALSE ESCALATION'}: ${f.title}`,
    })
    return entry
  }

  recordRecommendation(f: Omit<RecommendationFeedback, 'at'>): RecommendationFeedback {
    const entry = { ...f, at: new Date().toISOString() }
    this.recommendations.push(entry)
    return entry
  }

  attentionFeedback(): AttentionFeedback[] { return [...this.attention] }
  recommendationFeedback(): RecommendationFeedback[] { return [...this.recommendations] }

  reset(): void { this.attention = []; this.recommendations = [] }
}

export const feedback = new FeedbackLedger()
