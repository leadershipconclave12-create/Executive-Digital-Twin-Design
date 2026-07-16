import type { TwinState } from '../twin/model.js'
import type { OrgEvent } from './events.js'

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback)

// The twin as a REDUCER over events (Program #2: authoritative twin). Given the
// current twin and one normalized event, produce the next twin state. This is the
// ONLY place twin entities change — making the event log the source of truth.
export function applyEvent(twin: TwinState, e: OrgEvent): boolean {
  switch (e.kind) {
    case 'project.progress': {
      const p = twin.projects.find((x) => x.id === e.entityId)
      if (!p) return false
      if ('completion' in e.data) p.completion = clamp(num(e.data.completion, p.completion))
      if ('plannedCompletion' in e.data) p.plannedCompletion = clamp(num(e.data.plannedCompletion, p.plannedCompletion))
      return true
    }
    case 'project.risk': {
      const p = twin.projects.find((x) => x.id === e.entityId)
      if (!p) return false
      p.riskScore = clamp(num(e.data.riskScore, p.riskScore))
      return true
    }
    case 'channel.metric': {
      const c = twin.channels.find((x) => x.id === e.entityId)
      if (!c) return false
      if ('successRate' in e.data) c.successRate = clamp(num(e.data.successRate, c.successRate), 0, 100)
      if (typeof e.data.status === 'string') c.status = e.data.status as typeof c.status
      return true
    }
    case 'vendor.sla': {
      const v = twin.vendors.find((x) => x.id === e.entityId)
      if (!v) return false
      if ('slaAttainment' in e.data) v.slaAttainment = clamp(num(e.data.slaAttainment, v.slaAttainment), 0, 100)
      if (e.data.breach === true) v.breachesThisQuarter += 1
      return true
    }
    case 'vendor.renewal': {
      const v = twin.vendors.find((x) => x.id === e.entityId)
      if (!v) return false
      v.renewalInDays = Math.max(0, num(e.data.renewalInDays, v.renewalInDays ?? 0))
      return true
    }
    case 'release.signal': {
      const r = twin.releases.find((x) => x.id === e.entityId)
      if (!r) return false
      if ('riskScore' in e.data) r.riskScore = clamp(num(e.data.riskScore, r.riskScore))
      if ('readiness' in e.data) r.readiness = clamp(num(e.data.readiness, r.readiness))
      return true
    }
    case 'comms.signal': {
      const m = twin.managers.find((x) => x.id === e.entityId)
      if (!m) return false
      if ('commsQuality' in e.data) m.commsQuality = clamp(num(e.data.commsQuality, m.commsQuality))
      if ('loadIndex' in e.data) m.loadIndex = clamp(num(e.data.loadIndex, m.loadIndex))
      return true
    }
    case 'customer.metric': {
      const cm = twin.customer.find((x) => x.id === e.entityId)
      if (!cm) return false
      if ('value' in e.data) cm.value = num(e.data.value, cm.value)
      if ('deltaPct' in e.data) cm.deltaPct = num(e.data.deltaPct, cm.deltaPct)
      return true
    }
    default:
      return false
  }
}
