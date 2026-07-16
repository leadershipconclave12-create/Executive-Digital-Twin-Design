import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  User, Overview, Signal, DecisionItem, Delegation, Agent, AuditEvent, CommandEntry, PulseSnapshot,
  MemoryOverview, RecallAnswer, QualityReport, WisdomCandidate,
} from './types'
import { api, streamPulse, diagnose, ApiError } from './api'

let uid = 0
const genId = () => `c${++uid}`
const clock = () =>
  new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })

const officeShort = (id: string) =>
  id.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ').replace('Executive Intelligence', 'Exec Intel')

type Tab = 'pulse' | 'memory' | 'command-center' | 'governance'

const RECALL_EXAMPLES = [
  "Why did we reject XYZ Bank's proposal?",
  'What happened during the Diwali outage?',
  'What happened with the Release 15 delay?',
  'What lessons apply to deploys?',
  'What did we commit to?',
]

export default function App() {
  const [me, setMe] = useState<User | null>(null)
  const [tab, setTab] = useState<Tab>('pulse')
  const [pulse, setPulse] = useState<PulseSnapshot | null>(null)
  const [mem, setMem] = useState<MemoryOverview | null>(null)
  const [recallQ, setRecallQ] = useState('')
  const [recallA, setRecallA] = useState<RecallAnswer | null>(null)
  const [recalling, setRecalling] = useState(false)
  const [quality, setQuality] = useState<QualityReport | null>(null)
  const [candidates, setCandidates] = useState<WisdomCandidate[]>([])

  const [overview, setOverview] = useState<Overview | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [decisions, setDecisions] = useState<DecisionItem[]>([])
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [audit, setAudit] = useState<{ integrity: { valid: boolean; brokenAt?: number }; events: AuditEvent[] }>({ integrity: { valid: true }, events: [] })

  const [log, setLog] = useState<CommandEntry[]>([])
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState<{ text: string; kind: 'error' | 'ok' } | null>(null)
  /** Fatal: no backend. Must not auto-dismiss — it is the only thing on screen. */
  const [bootError, setBootError] = useState<string | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(async () => {
    const [ov, sig, dec, del, ag] = await Promise.all([
      api.overview().catch(() => null),
      api.signals().catch(() => []),
      api.decisions().catch(() => []),
      api.delegations().catch(() => []),
      api.agents().catch(() => []),
    ])
    if (ov) setOverview(ov)
    setSignals(sig); setDecisions(dec); setDelegations(del); setAgents(ag)
    const au = await api.audit().catch(() => null)
    if (au) setAudit(au)
    const mm = await api.memory().catch(() => null)
    setMem(mm)
    const [q, c] = await Promise.all([api.quality().catch(() => null), api.wisdomCandidates().catch(() => [])])
    setQuality(q); setCandidates(c)
  }, [])

  async function decideWisdom(id: string, approve: boolean) {
    try {
      if (approve) await api.approveWisdom(id)
      else await api.rejectWisdom(id)
      setNotice({ text: approve ? `${id} promoted to organizational wisdom.` : `${id} rejected.`, kind: 'ok' })
      await loadData()
    } catch (e) {
      setNotice({ text: (e as Error).message, kind: 'error' })
    }
  }

  async function askMemory(q: string) {
    const question = q.trim()
    if (!question) return
    setRecallQ(question)
    setRecalling(true)
    try {
      setRecallA(await api.recall(question))
    } catch (e) {
      setNotice({ text: (e as Error).message, kind: 'error' })
    } finally {
      setRecalling(false)
    }
  }

  const loadIdentity = useCallback(async () => {
    // Single user — no switching, no permissions to fetch.
    setMe((await api.me()).user)
  }, [])

  // Boot
  useEffect(() => {
    ;(async () => {
      try {
        await loadIdentity()
        await loadData()
        setLog([{
          id: genId(), role: 'eios', timestamp: clock(),
          text: 'Good morning, Deputy Chief. 3 items need you. Ask me anything, or say "brief me".',
          chips: ['Brief me', 'UPI status', 'Show decisions'],
        }])
      } catch (e) {
        setBootError(diagnose(e))
      }
    })()
  }, [loadData, loadIdentity])

  // Subscribe to the live organizational heartbeat (SSE). The dashboard breathes
  // whether or not the executive is doing anything — this is the operating system.
  useEffect(() => {
    const stop = streamPulse((snap) => setPulse(snap))
    return stop
  }, [])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])


  async function submit(text: string) {
    const command = text.trim()
    if (!command) return
    setInput('')
    setLog((l) => [...l, { id: genId(), role: 'exec', text: command, timestamp: clock() }])
    try {
      const r = await api.command(command)
      setLog((l) => [...l, { id: genId(), role: 'eios', text: r.reply, chips: r.chips, blocked: r.blocked, timestamp: clock() }])
      await loadData()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message
      setLog((l) => [...l, { id: genId(), role: 'eios', text: `⚠ ${msg}`, blocked: true, timestamp: clock() }])
    }
  }

  async function decide(id: string, decision: 'approved' | 'rejected') {
    try {
      await api.resolveDecision(id, decision)
      setNotice({ text: `${id} ${decision}. Logged to the decision journal.`, kind: 'ok' })
      await loadData()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message
      setNotice({ text: msg, kind: 'error' })
    }
  }

  async function clearSignal(id: string) {
    try { await api.handleSignal(id); await loadData() }
    catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }) }
  }

  const pendingDecisions = decisions.filter((d) => d.status === 'pending')
  const openSignals = signals.filter((s) => !s.handled).length

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span>
          <div>
            <div className="brand-title">EIOS · Executive Command Center</div>
            <div className="brand-sub">{overview?.executive.name} — {overview?.executive.org}</div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="pill pill-live">● Live</span>
          <span className="date">{overview?.executive.date}</span>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'pulse' ? 'tab tab-on' : 'tab'} onClick={() => setTab('pulse')}>
          Organizational Pulse {pulse && <span className="heartbeat">♥</span>}
        </button>
        <button className={tab === 'memory' ? 'tab tab-on' : 'tab'} onClick={() => setTab('memory')}>
          Organizational Memory
        </button>
        <button className={tab === 'command-center' ? 'tab tab-on' : 'tab'} onClick={() => setTab('command-center')}>Command Center</button>
        <button className={tab === 'governance' ? 'tab tab-on' : 'tab'} onClick={() => setTab('governance')}>Governance &amp; Agents</button>
        {me && <span className="role-chip">{me.title} · authority ₹{me.financialAuthorityInr.toLocaleString('en-IN')}</span>}
      </nav>

      {bootError && (
        <div className="boot-error">
          <div className="boot-error-title">⚠ No EIOS backend</div>
          <p>{bootError}</p>
          <p className="boot-error-hint">
            Everything below is empty because the UI has nothing to talk to — not because
            EIOS is broken.
          </p>
        </div>
      )}
      {notice && <div className={`notice notice-${notice.kind}`}>{notice.text}</div>}

      <div className="layout">
        <main className="ecc">
          {tab === 'pulse' && (
            <>
              {!pulse && <section className="card"><p className="fineprint">Connecting to the organizational heartbeat…</p></section>}
              {pulse && (
                <>
                  <section className="card pulse-hero">
                    <div className="pulse-hero-left">
                      <div className="pulse-hero-label">Organization Health · live</div>
                      <div className="pulse-hero-score">{pulse.organizationHealth}<span>/100</span></div>
                      <div className="pulse-hero-sub">
                        heartbeat #{pulse.tick} · {pulse.offices.filter((o) => o.band === 'healthy').length}/{pulse.offices.length} offices healthy
                        <span className="heartbeat heartbeat-lg">♥</span>
                      </div>
                    </div>
                    <div className="pulse-hero-right">
                      <div className="reclaim">
                        <div className="reclaim-big">{pulse.attention.forExecutive.length}</div>
                        <div className="reclaim-cap">need you</div>
                      </div>
                      <div className="reclaim">
                        <div className="reclaim-big">{pulse.attention.delegated.length}</div>
                        <div className="reclaim-cap">delegated</div>
                      </div>
                      <div className="reclaim">
                        <div className="reclaim-big">{pulse.attention.handledCount}</div>
                        <div className="reclaim-cap">handled</div>
                      </div>
                    </div>
                  </section>

                  <section className="card attention-card">
                    <div className="card-head">
                      <h2>Executive Attention · today</h2>
                      <span className="tag tag-auto">optimized · nobody asked</span>
                    </div>
                    <p className="briefing-headline">
                      {pulse.attention.forExecutive.length === 0
                        ? 'Nothing needs you right now. Everything is handled.'
                        : `These ${pulse.attention.forExecutive.length} things deserve your attention. Everything else is handled or delegated.`}
                    </p>
                    <div className="attn-list">
                      {pulse.attention.forExecutive.map((a) => (
                        <div className="attn attn-exec" key={a.id}>
                          <span className="attn-office">{officeShort(a.office)}</span>
                          <div className="attn-body">
                            <div className="attn-title">{a.title}</div>
                            <div className="attn-why">{a.why}</div>
                            <div className="attn-action">↳ {a.recommendedAction}</div>
                          </div>
                          <span className="attn-score">{Math.round(a.score * 100)}</span>
                        </div>
                      ))}
                    </div>
                    {pulse.attention.delegated.length > 0 && (
                      <>
                        <div className="attn-sub">Auto-delegated (tracked)</div>
                        <div className="attn-list">
                          {pulse.attention.delegated.map((a) => (
                            <div className="attn attn-del" key={a.id}>
                              <span className="attn-office">{officeShort(a.office)}</span>
                              <div className="attn-body">
                                <div className="attn-title">{a.title}</div>
                                <div className="attn-action">→ {a.delegateTo}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <p className="fineprint">≈ {pulse.attention.hoursReclaimed} executive hours reclaimed this cycle by not surfacing handled/delegated work.</p>
                  </section>

                  <section className="card">
                    <div className="card-head">
                      <h2>Perception Layer · what the twin is observing</h2>
                      <span className={pulse.perception.liveSources > 0 ? 'tag tag-ok' : 'tag tag-bad'}>
                        {pulse.perception.liveSources} live enterprise sources
                      </span>
                    </div>
                    {pulse.perception.liveSources === 0 && (
                      <p className="provenance-warn">
                        ⚠ No real enterprise system is connected. The twin is currently fed by the
                        <b> synthetic connector</b> — it is observing a simulation, not your organization.
                        Connect Graph / DevOps / ServiceNow / Monitor, or push events to <code>POST /api/events</code>.
                      </p>
                    )}
                    <div className="conns">
                      {pulse.perception.connectors.map((c) => (
                        <div className={`conn conn-${c.status}`} key={c.id}>
                          <div className="conn-top">
                            <span className="conn-name">{c.name}</span>
                            <span className={`conn-status cs-${c.status}`}>
                              {c.status === 'live' ? (c.id === 'synthetic' ? 'synthetic' : 'live') : 'not configured'}
                            </span>
                          </div>
                          <div className="conn-obs">{c.observes}</div>
                          <div className="conn-count">{c.eventsEmitted.toLocaleString()} events applied</div>
                        </div>
                      ))}
                    </div>
                    {pulse.perception.recentEvents.length > 0 && (
                      <>
                        <div className="attn-sub">Recent observations → twin</div>
                        <div className="evt-feed">
                          {pulse.perception.recentEvents.map((e) => (
                            <div className="evt" key={e.id}>
                              <span className="evt-src">{e.source}</span>
                              <span className="evt-kind">{e.kind}</span>
                              <span className="evt-ent">{e.entityId}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </section>

                  <section className="card">
                    <div className="card-head"><h2>AI Offices · continuous</h2><span className="tag">8 offices always running</span></div>
                    <div className="offices-grid">
                      {pulse.offices.map((o) => (
                        <div className={`office-monitor om-${o.band}`} key={o.office}>
                          <div className="om-top">
                            <span className="om-name">{o.name.replace(' Office', '')}</span>
                            <span className="om-score">{o.score}</span>
                          </div>
                          <div className="om-bar"><span style={{ width: `${o.score}%` }} className={`om-fill om-${o.band}`} /></div>
                          <div className="om-headline">{o.headline}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {pulse.predictions.length > 0 && (
                    <section className="card">
                      <div className="card-head"><h2>What EIOS Sees Coming</h2><span className="tag">predictions</span></div>
                      <div className="preds">
                        {pulse.predictions.map((p) => (
                          <div className="pred" key={p.id}>
                            <span className="pred-like">{Math.round(p.likelihood * 100)}%</span>
                            <div className="pred-body">
                              <div className="pred-title">{p.title}</div>
                              <div className="pred-meta">{officeShort(p.office)} · {p.horizon} · {p.impact}</div>
                              <div className="pred-reco">↳ {p.recommendation}</div>
                              {p.precedent?.map((pr) => (
                                <div className="pred-prec" key={pr.lessonId}>
                                  ⚑ <b>{pr.lessonId}</b> — {pr.rule}
                                  <span className="pred-scar"> (cost: {pr.scar})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'memory' && (
            <>
              {quality && (
                <section className="card">
                  <div className="card-head">
                    <h2>Knowledge Health · the platform judging itself</h2>
                    <span className={quality.overall >= 75 ? 'tag tag-ok' : quality.overall >= 50 ? 'tag' : 'tag tag-bad'}>
                      {quality.overall}/100
                    </span>
                  </div>
                  <p className="kh-weak">⚠ Weakest area: {quality.weakestArea}</p>
                  <div className="kh-grid">
                    {([
                      ['trustworthy', quality.totals.trustworthy, 'good'],
                      ['stale', quality.totals.stale, 'warn'],
                      ['unvalidated', quality.totals.unvalidated, 'warn'],
                      ['disputed', quality.totals.disputed, 'bad'],
                      ['superseded', quality.totals.superseded, 'dim'],
                      ['on moved foundations', quality.totals.restingOnMovedFoundations, 'bad'],
                    ] as const).map(([label, n, tone]) => (
                      <div className={`kh-cell kh-${tone}`} key={label}>
                        <div className="kh-n">{n}</div>
                        <div className="kh-l">{label}</div>
                      </div>
                    ))}
                  </div>
                  <ul className="kh-recs">
                    {quality.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </section>
              )}

              {candidates.filter((c) => c.status === 'candidate').length > 0 && (
                <section className="card">
                  <div className="card-head">
                    <h2>Candidate Wisdom · awaiting your approval</h2>
                    <span className="tag tag-bad">the system proposes · a human disposes</span>
                  </div>
                  <p className="fineprint" style={{ marginTop: 0 }}>
                    A pattern repeated enough times to look like a rule. It is <b>not</b> steering any
                    recommendation until you approve it.
                  </p>
                  {candidates.filter((c) => c.status === 'candidate').map((c) => (
                    <div className="cand" key={c.id}>
                      <div className="cand-top">
                        <span className="cand-id">{c.id}</span>
                        <span className="cand-n">observed {c.occurrenceCount}×</span>
                        <span className="cand-pat">{c.pattern}</span>
                      </div>
                      <div className="cand-rule">{c.proposedRule}</div>
                      <div className="cand-occ">{c.occurrences.map((o) => o.title).join(' · ')}</div>
                      <div className="actions" style={{ marginTop: 8 }}>
                        <button className="btn-approve" onClick={() => decideWisdom(c.id, true)}>Promote to wisdom</button>
                        <button className="btn-reject" onClick={() => decideWisdom(c.id, false)}>Reject</button>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              <section className="card">
                <div className="card-head">
                  <h2>Executive Recall</h2>
                  <span className="tag tag-auto">structured graph · no LLM</span>
                </div>
                <p className="fineprint" style={{ marginTop: 0, marginBottom: 10 }}>
                  Answers are assembled from records in the memory graph — every claim carries its
                  provenance. Memory reports what it does <b>not</b> know rather than guessing.
                </p>
                <form className="recall-form" onSubmit={(e) => { e.preventDefault(); askMemory(recallQ) }}>
                  <input
                    value={recallQ}
                    onChange={(e) => setRecallQ(e.target.value)}
                    placeholder='Ask institutional memory… e.g. "Why did we reject XYZ Bank?"'
                    aria-label="Memory recall question"
                  />
                  <button type="submit" className="btn-send" disabled={recalling}>
                    {recalling ? '…' : 'Recall'}
                  </button>
                </form>
                <div className="chips" style={{ marginTop: 10 }}>
                  {RECALL_EXAMPLES.map((q) => (
                    <button key={q} className="chip" onClick={() => askMemory(q)}>{q}</button>
                  ))}
                </div>

                {recallA && (
                  <div className="recall-answer">
                    <div className="ra-head">
                      <span className={`ra-conf ra-${recallA.confidence}`}>confidence: {recallA.confidence}</span>
                      <span className="ra-src">{recallA.basis.length} source{recallA.basis.length === 1 ? '' : 's'}</span>
                      {recallA.redactions.count > 0 && (
                        <span className="ra-redact" title={recallA.redactions.reason}>
                          🔒 {recallA.redactions.count} redacted
                        </span>
                      )}
                    </div>
                    <p className="ra-text">{recallA.answer}</p>

                    {recallA.lessons.length > 0 && (
                      <div className="ra-lessons">
                        {recallA.lessons.map((l) => (
                          <div className="scar" key={l.id}>
                            <div className="scar-rule">⚑ {l.rule}</div>
                            <div className="scar-cost">Learned the hard way: {l.scar}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {recallA.gaps.length > 0 && (
                      <div className="ra-gaps">
                        <b>What memory doesn't know:</b>
                        <ul>{recallA.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                      </div>
                    )}

                    {recallA.timeline.length > 0 && (
                      <>
                        <div className="attn-sub">Timeline</div>
                        <div className="mtl">
                          {recallA.timeline.map((t) => (
                            <div className="mtl-row" key={t.nodeId + t.at}>
                              <span className="mtl-at">{t.at}</span>
                              <span className="mtl-dot" />
                              <span className="mtl-what">{t.what}</span>
                              <span className="mtl-id">{t.nodeId}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {recallA.basis.length > 0 && (
                      <>
                        <div className="attn-sub">Provenance — every claim traced</div>
                        <div className="basis">
                          {recallA.basis.map((b, i) => (
                            <div className="basis-row" key={i}>
                              <span className="basis-id">{b.nodeId}</span>
                              <div className="basis-body">
                                <div className="basis-fact">{b.fact}</div>
                                <div className="basis-prov">
                                  ← {b.provenance.source}
                                  <span className={`conf conf-${b.provenance.confidence}`}>{b.provenance.confidence}</span>
                                </div>
                                {b.provenance.quote && <div className="basis-quote">“{b.provenance.quote}”</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Organizational Scars</h2>
                  <span className="tag">wisdom that outlives people</span>
                </div>
                <p className="fineprint" style={{ marginTop: 0 }}>
                  These rules actively change what the AI Offices recommend — see the precedent
                  attached to predictions on the Pulse.
                </p>
                {mem?.nodes.filter((n) => n.kind === 'lesson').map((l) => (
                  <div className="scar" key={l.id}>
                    <div className="scar-rule">⚑ {l.rule}</div>
                    <div className="scar-cost">Learned the hard way: {l.scar}</div>
                    <div className="scar-meta">{l.id} · {l.at} · from {l.provenance.source}</div>
                  </div>
                ))}
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Memory Fabric</h2>
                  <span className="tag">
                    {mem?.stats.nodes ?? 0} records · {mem?.stats.relations ?? 0} relations
                    {mem && mem.llmWithheld > 0 ? ` · ${mem.llmWithheld} never sent to LLM` : ''}
                  </span>
                </div>
                <div className="kind-strip">
                  {mem && Object.entries(mem.stats.byKind).map(([k, v]) => (
                    <span className="kind-pill" key={k}>{k} <b>{v}</b></span>
                  ))}
                </div>
                <table className="table">
                  <thead><tr><th>ID</th><th>Kind</th><th>When</th><th>Record</th><th>Source</th><th></th></tr></thead>
                  <tbody>
                    {mem?.nodes.map((n) => (
                      <tr key={n.id}>
                        <td className="mono">{n.id}</td>
                        <td><span className={`kind kind-${n.kind}`}>{n.kind}</span></td>
                        <td className="mono">{n.at}</td>
                        <td>
                          <div className="mem-title">{n.title}</div>
                          <div className="mem-sum">{n.summary}</div>
                        </td>
                        <td className="mem-src">{n.provenance.source}</td>
                        <td>
                          {n.sensitivity !== 'open' && (
                            <span className={`sens sens-${n.sensitivity}`}>{n.sensitivity}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {mem && mem.llmWithheld > 0 && (
                  <p className="fineprint">
                    🔒 {mem.llmWithheldNote} You can read them — it is your memory. They are
                    simply never placed in a prompt that leaves this machine (DPDPA).
                  </p>
                )}
              </section>
            </>
          )}

          {tab === 'command-center' && overview && (
            <>
              <section className="kpi-strip">
                {overview.kpis.map((k) => (
                  <div className="kpi" key={k.id}>
                    <div className="kpi-name">{k.name}</div>
                    <div className="kpi-value">{k.value}</div>
                    <div className="kpi-target">
                      <span className={`trend trend-${k.trend === k.good ? 'good' : 'warn'}`}>
                        {k.trend === 'up' ? '▲' : k.trend === 'down' ? '▼' : '■'}
                      </span>
                      target {k.target}
                    </div>
                  </div>
                ))}
              </section>

              <section className="card briefing">
                <div className="card-head">
                  <h2>Morning Briefing</h2>
                  <span className="tag tag-auto">Auto-generated 06:30</span>
                </div>
                <p className="briefing-headline">{overview.briefing.headline}</p>
                <ul className="briefing-list">
                  {overview.briefing.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </section>

              <div className="grid-2">
                <section className="card">
                  <div className="card-head"><h2>Priority Queue</h2><span className="tag">{openSignals} open</span></div>
                  <div className="signals">
                    {signals.map((s) => (
                      <div className={`signal ${s.handled ? 'signal-done' : ''}`} key={s.id}>
                        <span className={`sig-dot sig-${s.priority}`} />
                        <div className="sig-body">
                          <div className="sig-top">
                            <span className="sig-title">{s.title}</span>
                            <span className="sig-meta">{s.source} · {s.receivedAt}</span>
                          </div>
                          <div className="sig-summary">{s.summary}</div>
                          <div className="sig-action">↳ {s.suggestedAction} <span className="sig-agent">· {s.agent}</span></div>
                        </div>
                        {!s.handled && (
                          <button className="btn-ghost" onClick={() => clearSignal(s.id)}>Clear</button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="card">
                  <div className="card-head"><h2>Channel Health</h2><span className="tag">Real-time</span></div>
                  <div className="channels">
                    {overview.channels.map((c) => (
                      <div className={`channel channel-${c.status}`} key={c.id}>
                        <div className="ch-top">
                          <span className="ch-name">{c.name}</span>
                          <span className={`ch-status ch-${c.status}`}>{c.status}</span>
                        </div>
                        <div className="ch-value">{c.value}</div>
                        <div className="ch-bar"><span style={{ width: `${c.successRate}%` }} className={`ch-fill ch-${c.status}`} /></div>
                        <div className="ch-note">{c.metricLabel} · {c.note}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="card">
                <div className="card-head">
                  <h2>Decision Queue</h2>
                  <span className="tag">{pendingDecisions.length} pending · {decisions.length - pendingDecisions.length} auto/actioned</span>
                </div>
                <table className="table">
                  <thead>
                    <tr><th>ID</th><th>Decision</th><th>Tier</th><th>Risk</th><th>Amount</th><th>Conf.</th><th>Recommendation</th><th></th></tr>
                  </thead>
                  <tbody>
                    {decisions.map((d) => (
                      <tr key={d.id} className={d.status !== 'pending' ? 'row-muted' : ''}>
                        <td className="mono">{d.id}</td>
                        <td>{d.type}</td>
                        <td><span className={`tier tier-${d.tier.replace(/\s|-/g, '')}`}>{d.tier}</span></td>
                        <td><span className={`risk risk-${d.risk.toLowerCase()}`}>{d.risk}</span></td>
                        <td className="mono">{d.amountLabel ?? '—'}</td>
                        <td className="mono">{Math.round(d.confidence * 100)}%</td>
                        <td className="reco">{d.recommendation}</td>
                        <td className="actions">
                          {d.status === 'pending' ? (
                            <>
                              <button className="btn-approve" onClick={() => decide(d.id, 'approved')}>Approve</button>
                              <button className="btn-reject" onClick={() => decide(d.id, 'rejected')}>Reject</button>
                            </>
                          ) : (
                            <span className={`status-badge status-${d.status}`} title={d.decidedBy ? `by ${d.decidedBy}` : ''}>
                              {d.status === 'auto-executed' ? 'auto' : d.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="fineprint">Approvals are gated by role (RBAC) and financial authority (ABAC); the ₹10L autonomous hard-limit (ADR-003) is enforced server-side.</p>
              </section>

              <div className="grid-2">
                <section className="card">
                  <div className="card-head"><h2>Active Incidents</h2></div>
                  {overview.incidents.map((i) => (
                    <div className="incident" key={i.id}>
                      <span className={`sev sev-${i.severity}`}>{i.severity}</span>
                      <div className="inc-body">
                        <div className="inc-title">{i.title}</div>
                        <div className="inc-meta">{i.id} · {i.service} · {i.owner} · <b>{i.status}</b></div>
                        <div className="inc-impact">{i.customerImpact}</div>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="card">
                  <div className="card-head"><h2>Delegation Tracker</h2><span className="tag">{delegations.length} active</span></div>
                  {delegations.map((d) => (
                    <div className="deleg" key={d.id}>
                      <div className="deleg-top">
                        <span className="deleg-who">{d.delegate}</span>
                        <span className={`deleg-status ds-${d.status.replace(/\s/g, '')}`}>{d.status}</span>
                      </div>
                      <div className="deleg-subject">{d.subject}</div>
                      <div className="deleg-bar"><span style={{ width: `${d.progress}%` }} /></div>
                      <div className="deleg-meta">{d.authorityLevel} · {d.authorityNote} · due {d.deadline}</div>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}

          {tab === 'governance' && (
            <>
              <section className="card">
                <div className="card-head">
                  <h2>Agent Departments</h2>
                  <span className="tag">Vol 3 · {agents.filter((a) => a.status === 'active').length} active</span>
                </div>
                <div className="agents">
                  {agents.map((a) => (
                    <div className="agent" key={a.id}>
                      <div className="agent-top">
                        <span className="agent-name">{a.name}</span>
                        <span className={`agent-status as-${a.status}`}>{a.status}</span>
                      </div>
                      <div className="agent-charter">{a.charter}</div>
                      <div className="agent-meta">
                        <span className={`tier tier-${a.autonomyCeiling.replace(/\s|-/g, '')}`}>ceiling: {a.autonomyCeiling}</span>
                        <span className="agent-flows">{a.ownsWorkflows.join(' · ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Audit Journal</h2>
                  <span className={audit.integrity.valid ? 'tag tag-ok' : 'tag tag-bad'}>
                    {audit.integrity.valid ? '✓ chain verified' : `✗ broken at #${audit.integrity.brokenAt}`}
                  </span>
                </div>
                <table className="table">
                    <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Detail</th><th>Hash</th></tr></thead>
                    <tbody>
                      {audit.events.map((e) => (
                        <tr key={e.seq}>
                          <td className="mono">{e.seq}</td>
                          <td className="mono">{new Date(e.timestamp).toLocaleTimeString('en-IN', { hour12: false })}</td>
                          <td>{e.actor}<span className="audit-role"> · {e.actorRole}</span></td>
                          <td className="mono">{e.action}</td>
                          <td className="mono">{e.resource}</td>
                          <td className="reco">{e.detail}</td>
                          <td className="mono hash">{e.hash.slice(0, 10)}…</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="fineprint">Every EIOS action is hash-chained (SHA-256) — retroactive edits break verification (Vol 7 Ch 10).</p>
              </section>
            </>
          )}
        </main>

        <aside className="oneprompt">
          <div className="op-head">
            <h2>One Prompt</h2>
            <span className="op-sub">Interrogate the twin · the org already did the work</span>
          </div>
          <div className="op-feed" ref={feedRef}>
            {log.map((e) => (
              <div key={e.id} className={`msg msg-${e.role} ${e.blocked ? 'msg-blocked' : ''}`}>
                <div className="msg-role">{e.role === 'exec' ? (me?.name ?? 'You') : 'EIOS'} · {e.timestamp}</div>
                <div className="msg-text">{e.text}</div>
                {e.chips && (
                  <div className="chips">
                    {e.chips.map((c) => <button key={c} className="chip" onClick={() => submit(c)}>{c}</button>)}
                  </div>
                )}
              </div>
            ))}
          </div>
          <form className="op-input" onSubmit={(e) => { e.preventDefault(); submit(input) }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Command EIOS… e.g. "delegate the UPI issue"'
              aria-label="Command input"
            />
            <button type="submit" className="btn-send">Send</button>
          </form>
        </aside>
      </div>
    </div>
  )
}
