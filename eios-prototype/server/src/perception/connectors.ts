import type { TwinState } from '../twin/model.js'
import type { OrgEvent, SourceSystem } from './events.js'
import { makeEvent } from './events.js'

// Connectors are the Perception Layer's edge: each one owns an enterprise system,
// polls or receives from it, and emits NORMALIZED OrgEvents. The twin never talks
// to a source system directly.
//
// HONEST STATUS: only `synthetic` produces data in this POC. The four enterprise
// connectors below are typed, registered, and wired — but return no events until
// real credentials and an approved integration exist. They are deliberately visible
// (and reported as `configured: false`) so the gap is never hidden.

export type ConnectorStatus = 'live' | 'not-configured' | 'error'

export interface Connector {
  readonly id: SourceSystem
  readonly name: string
  /** What this connector observes in the real organization. */
  readonly observes: string
  /** True only when real credentials/integration are present. */
  isConfigured(): boolean
  /** Emit events observed since the last poll. Must be side-effect free w.r.t. the twin. */
  poll(twin: Readonly<TwinState>): OrgEvent[]
  status(): ConnectorStatus
}

// --- Synthetic connector (POC only) ----------------------------------------
// Generates plausible movement so the system is demonstrable with zero credentials.
// This is a STAND-IN for the organization, and is labelled as such everywhere.
const drift = (v: number, m: number, bias = 0) => v + (Math.random() - 0.5) * m + bias
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

export class SyntheticConnector implements Connector {
  readonly id = 'synthetic' as const
  readonly name = 'Synthetic Organization (POC)'
  readonly observes = 'Simulated movement — stands in for real enterprise signals'
  private ticks = 0

  isConfigured(): boolean { return true }
  status(): ConnectorStatus { return 'live' }

  poll(twin: Readonly<TwinState>): OrgEvent[] {
    this.ticks += 1
    const out: OrgEvent[] = []

    for (const p of twin.projects) {
      const plannedCompletion = clamp(p.plannedCompletion + 0.15)
      const completion = clamp(drift(p.completion, 0.5, 0.05))
      const behind = plannedCompletion - completion
      out.push(makeEvent('synthetic', 'project.progress', p.id, { completion, plannedCompletion }))
      out.push(makeEvent('synthetic', 'project.risk', p.id, { riskScore: clamp(drift(p.riskScore, 1.2, behind * 0.15)) }))
    }
    for (const m of twin.managers) {
      out.push(makeEvent('synthetic', 'comms.signal', m.id, {
        commsQuality: clamp(drift(m.commsQuality, 1.5, m.loadIndex > 85 ? -0.4 : 0.1)),
        loadIndex: clamp(drift(m.loadIndex, 1.5)),
      }))
    }
    for (const v of twin.vendors) {
      out.push(makeEvent('synthetic', 'vendor.sla', v.id, {
        slaAttainment: clamp(drift(v.slaAttainment, 0.15, v.breachesThisQuarter > 2 ? -0.05 : 0.02), 80, 100),
      }))
      if (v.renewalInDays !== undefined && this.ticks % 8 === 0) {
        out.push(makeEvent('synthetic', 'vendor.renewal', v.id, { renewalInDays: Math.max(0, v.renewalInDays - 1) }))
      }
    }
    for (const r of twin.releases) {
      out.push(makeEvent('synthetic', 'release.signal', r.id, {
        riskScore: clamp(drift(r.riskScore, 1.5, 0.1)),
        readiness: clamp(drift(r.readiness, 1.0, 0.15)),
      }))
    }
    for (const c of twin.channels) {
      out.push(makeEvent('synthetic', 'channel.metric', c.id, {
        successRate: clamp(drift(c.successRate, 0.2, c.status === 'degraded' ? 0.03 : 0), 90, 100),
      }))
    }
    const complaints = twin.customer.find((c) => c.id === 'merchant-complaints')
    if (complaints) {
      out.push(makeEvent('synthetic', 'customer.metric', complaints.id, {
        value: Math.max(0, Math.round(drift(complaints.value, 4, 0.2))),
      }))
    }
    return out
  }
}

// --- Enterprise connectors (typed, wired, NOT yet fed) ----------------------
// Each documents exactly what it will observe and what it needs to go live.
abstract class UnconfiguredConnector implements Connector {
  abstract readonly id: SourceSystem
  abstract readonly name: string
  abstract readonly observes: string
  /** Env vars required before this connector can emit real events. */
  protected abstract requiredEnv(): string[]

  isConfigured(): boolean {
    return this.requiredEnv().every((k) => Boolean(process.env[k]))
  }
  status(): ConnectorStatus {
    return this.isConfigured() ? 'live' : 'not-configured'
  }
  poll(): OrgEvent[] {
    // Deliberately emits nothing until a real integration is implemented and
    // credentialed. Returning fabricated data here would make the twin lie.
    return []
  }
}

export class MsGraphConnector extends UnconfiguredConnector {
  readonly id = 'ms-graph' as const
  readonly name = 'Microsoft Graph'
  readonly observes = 'Teams activity, calendar, mail cadence → comms.signal, meeting load'
  protected requiredEnv() { return ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET'] }
}

export class AzureDevOpsConnector extends UnconfiguredConnector {
  readonly id = 'azure-devops' as const
  readonly name = 'Azure DevOps'
  readonly observes = 'Work items, sprint burndown, pipelines → project.progress, release.signal'
  protected requiredEnv() { return ['ADO_ORG_URL', 'ADO_PAT'] }
}

export class ServiceNowConnector extends UnconfiguredConnector {
  readonly id = 'servicenow' as const
  readonly name = 'ServiceNow'
  readonly observes = 'Incidents, changes, vendor SLA records → vendor.sla, project.risk'
  protected requiredEnv() { return ['SNOW_INSTANCE', 'SNOW_USER', 'SNOW_PASSWORD'] }
}

export class AzureMonitorConnector extends UnconfiguredConnector {
  readonly id = 'azure-monitor' as const
  readonly name = 'Azure Monitor'
  readonly observes = 'Production metrics/alerts (UPI, IMPS, APIs) → channel.metric'
  protected requiredEnv() { return ['AZ_MONITOR_WORKSPACE_ID', 'AZ_MONITOR_CLIENT_SECRET'] }
}

export function defaultConnectors(): Connector[] {
  return [
    new SyntheticConnector(),
    new MsGraphConnector(),
    new AzureDevOpsConnector(),
    new ServiceNowConnector(),
    new AzureMonitorConnector(),
  ]
}
