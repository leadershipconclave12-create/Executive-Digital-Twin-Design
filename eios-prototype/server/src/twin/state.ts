import type { TwinState } from './model.js'

// The twin's SEED — its initial known state of the organization, using the same
// banking scenario as the volumes.
//
// The twin does NOT evolve itself. It is event-sourced: the Perception Layer folds
// normalized OrgEvents from connectors into this state via `perception/reducer.ts`.
// In production the seed would be a backfill from the real systems of record.

export function seedTwin(): TwinState {
  const now = new Date().toISOString()
  return {
    tick: 0,
    startedAt: now,
    lastTickAt: now,
    projects: [
      { id: 'PRJ-A', name: 'UPI Autoscale Programme', completion: 72, plannedCompletion: 82, riskScore: 61, deadline: '2026-08-05', em: 'EM-B' },
      { id: 'PRJ-B', name: 'Tokenisation Compliance', completion: 40, plannedCompletion: 45, riskScore: 48, deadline: '2026-10-14', em: 'EM-C' },
      { id: 'PRJ-C', name: 'Mobile v8.4 Rollout', completion: 88, plannedCompletion: 85, riskScore: 22, deadline: '2026-07-28', em: 'EM-A' },
    ],
    managers: [
      { id: 'EM-A', name: 'EM – Mobile', team: 'Mobile', commsQuality: 84, loadIndex: 58 },
      { id: 'EM-B', name: 'EM – UPI Platform', team: 'UPI', commsQuality: 63, loadIndex: 88 },
      { id: 'EM-C', name: 'EM – Compliance Eng', team: 'Compliance', commsQuality: 79, loadIndex: 66 },
    ],
    vendors: [
      { id: 'VEND-AXIS', name: 'AxisPay', service: 'UPI PSP', slaAttainment: 96.2, breachesThisQuarter: 3, renewalInDays: 210 },
      { id: 'VEND-AKAMAI', name: 'Akamai', service: 'CDN', slaAttainment: 99.1, breachesThisQuarter: 0, renewalInDays: 12 },
    ],
    releases: [
      { id: 'REL-18', name: 'Release 18 — Payments Core', scheduledIn: '6 days', riskScore: 58, readiness: 71 },
    ],
    channels: [
      { id: 'upi', name: 'UPI', successRate: 97.1, status: 'degraded' },
      { id: 'imps', name: 'IMPS', successRate: 99.6, status: 'healthy' },
      { id: 'mobile', name: 'Mobile Banking', successRate: 99.4, status: 'healthy' },
    ],
    regulations: [
      { id: 'RBI-44', name: 'RBI/2026-27/44 Tokenisation', windowDays: 90, requiresRoadmapChange: true, addressed: false },
    ],
    customer: [
      { id: 'merchant-complaints', name: 'Merchant complaints', value: 134, deltaPct: 34, unit: '/day' },
      { id: 'app-rating', name: 'App store rating', value: 4.3, deltaPct: -2, unit: '★' },
      { id: 'nps', name: 'Digital NPS', value: 41, deltaPct: -3, unit: '' },
    ],
  }
}
