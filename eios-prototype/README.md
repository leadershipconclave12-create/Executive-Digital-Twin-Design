# EIOS — Executive Intelligence Operating System (Reference Implementation)

A full-stack, runnable reference implementation of the EIOS product described in the
7-volume architecture set. It embodies the concepts from every volume in working,
typed, tested code — **not** a mock UI. Built for the Deputy Chief (Operations)
**Deputy Chief (Products)** of an Indian retail bank, using the same UPI/banking scenario
throughout.

> ### Single user
> EIOS serves **exactly one person**. There are no roles, no permission matrix, no
> "acting as" (ADR-010). The delegates it names - "VP - IT Operations" and friends -
> *receive work*; they never log in.
>
> The governance did not disappear, it sharpened. The boundary was never human-vs-human;
> it is **this machine vs the model**: `personal` and `restricted` memory is readable by
> him and **never placed in a prompt that leaves the laptop**.

> **This is an operating system, not a prompt platform.** The center of EIOS is the
> **Organizational Digital Twin**, not a chat box. A **heartbeat (the Pulse)** runs
> every few seconds — evolving the twin, running 8 AI Offices, and optimizing where
> the executive's scarce hours go — **whether or not anyone is looking**. The
> executive is interrupted only when required; "One Prompt" is how you *interrogate a
> system that already did the work*, not how work gets started.

## The inversion

| | Platform (pull) | Operating System (push) — this build |
|---|---|---|
| Center | The prompt box | The **Organizational Twin** |
| Trigger | User asks | **Events → perception → reasoning**, continuously |
| Cadence | On request | A **4s heartbeat**; the org is re-understood every tick |
| Work unit | An agent runs a task | **8 AI Offices** that never stop |
| Executive | Operator | **Managed** — sees only the 3 things that need them |
| Signature feature | Answers well | **Executive Attention Engine** |

```
Connectors → OrgEvents → Perception Layer → Organizational Twin (event-sourced)
           → AI Offices (observe + predict, consulting Memory) → Attention Engine
           → { 3 for you · delegated · handled silently }
                            ▲
        Organizational Memory Fabric ── institutional history, decisions, scars
```

**Memory before Brain.** A reasoning engine with no institutional history only knows
today. *"Should we delay Release 18?"* is answered differently once memory supplies
*"Release 15 slipped → complaints → 1,100 merchants churned → CEO escalation."* That is
why the Memory Fabric was built before any simulation/planning engine.

## 🔒 EIOS Architecture v1.0 — FROZEN

**The architecture is frozen.** Not because the system is production-ready — it is not —
but because *the conceptual architecture is stable enough to stop redesigning the core*.
Further architectural invention would now improve the diagrams more than the product.

Three artifacts define the platform. **Read these before changing anything:**

| Artifact | What it is |
|---|---|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | The constitution — principles, bounded contexts, event model, data contracts, security, **failure modes**, extension points, change control |
| **[docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md)** | The language — all 22 concepts with attributes, lifecycle, relationships, ownership, invariants, and honest status |
| **[docs/ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md)** | The rules — 15 standards, each with a **conformance audit against the real code** |

### The freeze question

Every proposal from here is judged by one test:

> **Does this make the Deputy Chief's day measurably easier, or does it only make the
> architecture more sophisticated?**

If it doesn't reduce cognitive load, improve decision quality, or safely automate
executive work, it belongs in the backlog — not the core platform.

### What the freeze exposed

Writing the documents against the code (rather than against intent) surfaced **9 domain
defects and 3 standards violations** — recorded, not quietly fixed:

| # | Defect | Why it matters |
|---|---|---|
| **F1** | **Decision is modelled twice, unlinked** (`DecisionItem` ⇎ `DecisionMemory`) | Approving a decision creates no memory of it. Today's decisions never become tomorrow's memory — undermining the platform's core premise. |
| **F4** | **Policy is not modelled** — governance is hardcoded | Changing a rule needs a code deploy. Regulators don't ship on your release train. |
| **F5** | **Recommendation is a bare `string`** | Violates Standard S1. The advice the executive actually acts on has no provenance. |
| **F2** | **Risk is an adjective, not a noun** | A Risk Office cannot operate on `riskScore: 61`. |
| **FM6** | **Knowledge fabric is lost on restart** | The twin replays; memory does not. The org forgets what it learned. |

**Standards conformance: 10/15 enforced, 3 partial, 3 violated** — and the violations
share a cause: the *operational* layer (`DecisionItem`, `Prediction`, `AttentionItem`)
predates the standards the *knowledge* layer set. One coherent workstream, not scattered rot.

**Recommended order** (by the freeze question): FM6 → F1 → F5 → F4 → F2.

---

## Phase 1 — COMPLETE. Phase 2 — Enterprise Platform Engineering (in progress)

**Phase 1 is declared complete** — not because the system is production-ready, but
because the *conceptual architecture is stable enough to stop redesigning the core*.
The remaining work is no longer "what should the AI do?" It is **"how does this survive
five years inside a bank?"** — a different engineering discipline.

```
Feature Development  ──►  Platform Engineering  ──►  Enterprise Engineering  ──►  Production Ops
   (complete)               (◄ we are here)              (not started)             (not started)
```

**Phase 2, increment 1 (built):** the **Event Store**.

```
Event → Immutable Log → Replay → Materialized Views → Organizational Twin
```

The twin is no longer state that events mutate; it is a **derived view of the log**. That
one inversion buys durability, replay, rebuild, time travel, full input audit, and the
ability to run tomorrow's reasoning against yesterday's organization.

| Capability | Status |
|---|---|
| **Durable event log** (append-only JSONL, corrupt-tail tolerant) | ✅ verified across a real process kill |
| **Replay** (log ⇒ twin, snapshot resume) | ✅ |
| **Replay determinism** (same history ⇒ identical state) | ✅ verified at boot, exposed as a metric |
| **Time travel** (`asOf`) | ✅ `GET /api/platform/as-of/2026-03-14T00:00:00Z` |
| **Knowledge replay** (today's reasoning vs. a past org) | ✅ `replayAgainstHistory()` |
| **Architecture scorecard** | ✅ replaces test-count as the measure of success |

**Deliberately NOT built this increment** — each is a real gap, none justified itself
against the caution that *architecture debt now outweighs missing functionality*:
Policy Engine (externalised governance), Explainability Engine, Meta-Reasoning,
versioned knowledge, multi-tenancy, HA/DR, distributed processing.

### Durability, proven

```
BOOT 1   Event log: 0 events        Twin rebuilt: 0 events replayed     Determinism: VERIFIED
         → push: PRJ-A completion 91%
         → log now holds 33 events (durable)
[process killed]
BOOT 2   Event log: 33 events       Twin rebuilt: 33 events replayed    Determinism: VERIFIED
         → PRJ-A completion after restart: 91.2%   ← the organization remembered
```

### Success is not test count

"152 tests pass" is hygiene — it says the code behaves as written, nothing about whether
EIOS is a trustworthy Executive Operating System. `GET /api/platform/scorecard` reports
the measures that matter, and **refuses to invent the ones it cannot compute**:

```
3/8 architecture metrics are measurable today. 5 require signals the platform does not
yet capture — reported as unmeasurable rather than estimated.

OK Replay determinism               1
OK Knowledge integrity              71%
OK Autonomous handling rate         40%
-- Twin freshness                   NOT MEASURABLE  (no events ingested this process)
-- Executive attention precision    NOT MEASURABLE  (needs executive feedback; 0 captured)
-- False escalation rate            NOT MEASURABLE  (needs executive feedback)
-- Recommendation acceptance rate   NOT MEASURABLE  (not yet wired into the approval flow)
-- Missed critical event rate       NOT MEASURABLE  (NOT self-measurable by design)
```

Two of those are worth dwelling on:

- **Missed critical event rate** can *never* be self-measured — a missed event is one EIOS
  never saw, so its own data cannot reveal it. It requires post-incident review. Any
  number here would be a lie.
- **Attention precision** becomes real only once the executive judges surfaced items.
  A minimal feedback endpoint makes it measurable (`6/8` after 4 judgements: precision
  75%, false escalation 25%) — and it **refuses to compute a rate from <3 samples**,
  because a rate over two data points is noise wearing a percentage sign.

## Milestone: Executive Knowledge Platform v1

Feature development is **deliberately frozen**. No Executive Brain, no Meeting
Representative — instead the knowledge layer has been hardened, on this principle:

> **If the knowledge layer is correct, you can upgrade reasoning models forever.
> If it is weak, even the best reasoning model produces unreliable executive advice.**

So the goal is not "more AI". It is: *make the knowledge platform so robust that any
future reasoning engine can rely on it.*

| Hardening | What it means |
|---|---|
| **Temporal decisions** | Decisions carry explicit **assumptions**; when one breaks, **validity** degrades (`holds → at_risk → invalid`) and recall says so unprompted |
| **Org ≠ Executive memory** | `layer: organizational` (facts) vs `executive` (this executive's judgment) — modelled, decayed and governed separately |
| **Decision lineage** | `depends_on` ancestry + **invalidation propagation**: supersede a budget and every conclusion resting on it is flagged |
| **Multidimensional confidence** | evidence · reasoning · policy · freshness · humanValidation → overall **plus the dimension that limits it** |
| **Knowledge ages** | `active → stale → superseded → obsolete`; **events never stale** (history happened), estimates do |
| **Organizational wisdom** | pattern → repeated 3× → **candidate** → *human approves* → wisdom; "resembles L-1 from Diwali 2025" |
| **Living, not records** | Knowledge evolves **on every heartbeat**: auto-capture, conflict detection, supersession, lesson proposal, re-scoring |
| **Knows its own quality** | The platform scores its **own** reliability and names its weakest area |

**The twin is event-sourced.** It does not evolve itself: the *only* way its state
changes is by applying a normalized `OrgEvent` that arrived through a Connector or the
`POST /api/events` ingestion endpoint. That is the architectural difference between
"observing a simulation" and "an architecture built to observe the organization —
currently fed by a synthetic connector."

> ## Honest status: this is a **technical proof of concept**, not production software
>
> Passing tests and a live demo prove only that *the implemented behaviors work as
> intended*. They demonstrate **nothing** about resilience under enterprise load,
> security review, regulatory compliance, disaster recovery, or long-term operational
> reliability. Those are separate engineering programs that come **after** a
> successful PoC.
>
> **Most importantly: no real enterprise system is connected.** The twin is currently
> fed by a clearly-labelled `SyntheticConnector`. Until Graph/DevOps/ServiceNow/Monitor
> are wired with real credentials, **the twin is observing a simulation, not your
> organization.** The UI states this in the Perception panel and the API reports
> `liveSources: 0` — the gap is surfaced, never hidden.
>
> Rough maturity: **vision ~90% · architecture ~90% · prototype ~55% · enterprise
> readiness ~20%.**

---

## ⚡ Want to actually use it? → **[SETUP.md](SETUP.md)**

Real reasoning on **your own exported email**, **no admin ticket**, ~$0.05/day.
`docs/` has the frozen architecture; **SETUP.md** has the thing you can run today.

## Quick start

```bash
cd eios-prototype
npm run install:all      # installs server + web deps
npm run dev              # starts backend (:4180) and web (:5180) together
# open http://localhost:5180
```

Other commands:

```bash
npm test                 # backend test suite (177 tests)
npm run build            # typecheck + build both server and web
npm run dev:server       # backend only
npm run dev:web          # web only
```

## Try it

1. Open http://localhost:5180 — it opens on the **Organizational Pulse**. Watch it
   *breathe*: org health, the 8 AI Office monitors, and the **Executive Attention**
   queue update live (SSE) every 4 seconds. Nobody is prompting it.
2. Read the attention panel: **"these 3 things deserve you; everything else is handled
   or delegated"** — the Attention Engine surfaces UPI degradation, the behind-plan
   UPI Autoscale programme, and the Akamai renewal; it delegates the rest with owners.
3. Open **Organizational Memory** and ask *"Why did we reject XYZ Bank's proposal?"* —
   you get the rationale chain, the blocking approval gap, the alternatives, your own
   quoted words, the unmet revisit condition, and a provenance trail for every claim.
   No LLM is involved. Then look at **Organizational Scars**.
4. Back on the **Pulse**, note the ⚑ precedent attached to predictions — memory is
   changing what the Offices recommend.
5. Switch to **Command Center** to act, or **One Prompt** (right panel) to interrogate:
   `brief me`, `UPI status`, `why did we reject XYZ Bank?`, `delegate the UPI issue`.
6. Approve/reject items directly in the **Decision Queue**.
7. Use **"Acting as"** (top-right) to switch roles — this genuinely changes what the
   backend permits:
   - As **VP – IT Operations**, try to approve the ₹1.2Cr CDN renewal → **blocked**
     (exceeds ₹5L authority) and the One-Prompt input is disabled for delegation.
   - As **Internal Auditor**, open **Organizational Memory** → the coaching notes on
     EM-B are withheld (`🔒 1 redacted`) while decision history stays readable:
     audit scope is not a licence for HR data.
   - As **Internal Auditor**, open **Governance & Agents** → read the tamper-evident
     **Audit Journal** (approvals are blocked — read-only).
8. Watch the **Audit Journal** chain-verify (`✓ chain verified`) after every action.

---

## How the code maps to the 7 volumes

| Volume | Concept | Where it lives |
|---|---|---|
| **Vol 1 — Product Vision** | Organization-centered OS; continuous ops; ~90% workload reduction via attention optimization | `twin/` (pulse, offices, attention); `web/` Pulse view |
| **Vol 2 — Business Architecture** | Decision taxonomy (Tier 1/2/3), delegation entity + lifecycle, KPI framework, authority matrix | `services/decisions.ts`, `services/delegations.ts`, `data/seed.ts` |
| **Vol 3 — Cognitive & AI** | AI Offices/Departments, continuous perception→prediction, **Organizational Memory + precedent-aware recommendations**, decision engine (tiering), pluggable model | `twin/offices.ts`, `twin/pulse.ts`, **`memory/`**, `cognitive/`, `governance/guardrails.ts` |
| **Vol 4 — Technical Architecture** | Layered design, REST API tier, in-process event backbone, repository seam | `api/`, `events/bus.ts`, `data/store.ts` |
| **Vol 5 — Engineering** | Tests, typed contracts, one-command run, CI-ready | `src/__tests__/`, `package.json` scripts |
| **Vol 6 — UX & Dashboards** | ECC dashboard, widgets, One Prompt UI, theme-aware, role switcher | `web/src/App.tsx`, `web/src/styles.css` |
| **Vol 7 — Governance & Security** | RBAC + ABAC, ₹10L autonomy hard-limit (ADR-003), tamper-evident audit journal, four-eyes, **DPDPA-governed People Memory with reported redaction** | `governance/rbac.ts`, `governance/guardrails.ts`, `governance/audit.ts`, `memory/fabric.ts` |

### The governance guarantees are enforced in code (not just UI)

- **ADR-003 ₹10L hard-limit** — `evaluateAutoExecution()` refuses any autonomous spend
  ≥ ₹10L regardless of confidence; proven by `guardrails.test.ts`.
- **RBAC** — every route is permission-gated (`requirePermission`); the One-Prompt
  surface runs through the *same* checks, so it can't exceed the executive's authority.
- **ABAC authority** — a user cannot approve beyond their financial authority
  (`canUserApprove`); a VP is blocked from the ₹1.2Cr renewal.
- **Tamper-evident audit** — every domain event is SHA-256 hash-chained; `verify()`
  re-derives the chain and detects any retroactive edit.
- **Personal-data governance** — People Memory needs a distinct `memory:personal`
  permission; the fabric (not the UI) withholds it, and redactions are *reported*.

---

## Architecture

```
Browser (Pulse monitor · Command Center · One Prompt)
        │  /api  +  /api/pulse/stream (SSE heartbeat)
        ▼
Express API  ──►  authenticate → RBAC (requirePermission) → handler
        │
        ├─ platform/      PHASE 2: event store · replay · time travel · scorecard
        │    eventStore     append-only durable log — THE SYSTEM OF RECORD
        │    replay         log ⇒ twin · determinism · asOf() time travel
        │    metrics        architecture scorecard (honest about the unmeasurable)
        ├─ twin/          Organizational Digital Twin (a MATERIALIZED VIEW of the log)
        │    model+state    living org model, evolves every heartbeat
        │    offices        8 AI Offices — continuous observe() + predict()
        │    attention      Executive Attention Engine (rank → 3 / delegate / handle)
        │    pulse          the heartbeat loop + SSE fan-out
        ├─ services/      business logic (decisions, delegations, signals)
        ├─ cognitive/     command service + AI provider seam + agents/KG
        ├─ governance/    rbac · guardrails · audit (subscribes to the bus)
        ├─ events/bus     in-process event backbone (→ Azure Event Grid/Service Bus)
        └─ data/store     in-memory repository (→ Cosmos DB / Azure SQL)
```

### The Perception Layer (`perception/`) — the twin's only input

- **`events.ts`** — the canonical `OrgEvent` model + validation at the ingestion boundary.
- **`reducer.ts`** — `applyEvent(twin, event)`: the **only** place twin entities change.
  Unknown entities are **rejected, not invented**; values are clamped.
- **`connectors.ts`** — the `Connector` interface and five registered connectors:
  | Connector | Status | Observes |
  |---|---|---|
  | `SyntheticConnector` | **live (POC stand-in)** | Simulated movement |
  | `MsGraphConnector` | not-configured | Teams/calendar/mail cadence → `comms.signal` |
  | `AzureDevOpsConnector` | not-configured | Work items, pipelines → `project.progress`, `release.signal` |
  | `ServiceNowConnector` | not-configured | Incidents, vendor SLAs → `vendor.sla`, `project.risk` |
  | `AzureMonitorConnector` | not-configured | Production metrics → `channel.metric` |

  The four enterprise connectors are typed and wired but **emit nothing** without
  credentials — fabricating data there would make the twin lie. Each declares the env
  vars it needs to go live.
- **`index.ts`** — `PerceptionLayer` owns the twin; polls connectors, folds events,
  and reports provenance (`liveSources`, per-connector counts, recent events).

**Push a real event yourself** (this is how live systems will feed it):

```bash
curl -X POST http://localhost:4180/api/events \
  -H 'content-type: application/json' -H 'x-eios-user: u-dc' \
  -d '{"source":"azure-monitor","kind":"channel.metric","entityId":"upi",
       "data":{"successRate":84.5,"status":"critical"}}'
```

The twin updates → the Operations Office re-observes → the Attention Engine re-ranks,
and the executive's top item changes to *"UPI critical at 84.5%"*.

### The Knowledge layer (`knowledge/`) — semantics over the graph

`memory/` is the **structure** (graph + traversal). `knowledge/` is the **semantics**.

| Module | Responsibility |
|---|---|
| `confidence.ts` | Multidimensional confidence. **Not** a weighted average — a strong dimension must not average away a fatal one, so `overall` is capped near the weakest dimension and by validation state (disputed ⇒ ≤40%). Names `limitedBy`. |
| `lifecycle.ts` | Aging + supersession + `validityOf(decision)` derived from assumptions. Per-kind decay: an `event` **never** stales; a `project` estimate stales in 30 days. |
| `lineage.ts` | `ancestry()`, `descendants()`, `invalidationRisks()` — conclusions resting on foundations that moved. |
| `wisdom.ts` | Pattern detection → candidate → **human approval** → attributed wisdom. `resembles()` matches live situations to scars. |
| `quality.ts` | The platform's assessment of its **own** knowledge: trustworthy / stale / unvalidated / disputed / on-moved-foundations, + the weakest area. |
| `evolution.ts` | The living loop: auto-capture, conflict detection, supersession, assumption-breaking, lesson proposal — on every heartbeat. |

**Try the platform judging itself:**

```bash
curl localhost:4180/api/knowledge/quality -H 'x-eios-user: u-dc'
# → overall 77/100, weakest: "7 record(s) never validated by a human"
#   project knowledge avgConfidence 0.15 — stale, so freshness collapsed the score
```

It does **not** report 100/100. A knowledge base that rates itself perfect is lying.

**The wisdom pipeline, end to end** (verified live):

```
3 Azure Monitor incidents → auto-captured (AC-1..3) → pattern "incident+channel" detected
  → candidate W-1 proposed (NOT steering anything yet)
  → VP tries to approve → 403 (setting org policy is an executive act)
  → Deputy Chief approves → L-W-1, approvedBy: "Deputy Chief", humanValidation: validated
```

**A decision going stale in the real world** (verified live):

```
D-193 validity: holds
  → NPCI confirms the circular is deferred to 2027   (breaks assumption A1)
  → D-193 validity: at_risk
  → recall now leads with: "⚠ Current validity: AT_RISK. The decision rested on
     assumptions that have since broken: NPCI will publish ... within Q2 2026."
```

Nobody asked it to re-examine that decision.

### The Organizational Memory Fabric (`memory/`) — the heart

**Not a pile of vector embeddings.** The source of truth is a *structured graph*:
entities, typed relations, timelines, and provenance. Lexical `search()` exists only as
a **retrieval aid** to find an entry point; it never produces the answer. (A vector
index would slot into that same seam — as an aid, not as truth.)

- **`model.ts`** — 8 memory kinds: `decision`, `meeting`, `project`, `person`,
  `relationship`, `strategic`, `event`, `lesson`. Every node carries `Provenance`
  (source, who recorded it, and **epistemic status**: `stated` / `derived` / `inferred`)
  and a `sensitivity` classification.
- **`fabric.ts`** — the graph: `timeline()`, `neighbors()`, `trace()` (walks causal
  chains), `lessonsFor()`, and governance-gated visibility.
- **`seed.ts`** — the institutional history (D-193 XYZ Bank rejection, the Diwali
  outage, the Release 15 → churn → escalation chain).
- **`recall.ts`** — the recall engine. **No LLM.**

**The thesis, demonstrated:** answering *"Why did we reject XYZ Bank's proposal?"*
requires **memory, not a bigger model**. Ask it:

```bash
curl -X POST http://localhost:4180/api/memory/recall \
  -H 'content-type: application/json' -H 'x-eios-user: u-dc' \
  -d '{"question":"Why did we reject XYZ Bank'"'"'s proposal?"}'
```

It returns — assembled from the graph, with 14 provenance-traced sources:

> **14 March 2026 — Decision D-193.** Rejected because: Merchant adoption risk →
> Fraud concern → Engineering estimate doubled → Risk Committee approval absent.
> **Blocking gap:** Risk Committee never convened. **Alternatives:** reduced scope
> (XYZ declined), white-label (no engineering capacity). **Deputy Chief said:**
> *"We'll revisit after NPCI publishes the new circular."* **Revisit condition:**
> the NPCI circular *has not published* — condition unmet as of July 2026.

That last line matters: memory **volunteers** that the condition it's waiting on is
still unmet. That's executive memory, not an archive.

#### Organizational scars — memory that changes behavior

Lessons (`L-1`, `L-2`) encode what things *cost*, and they **actively change
recommendations**:

| | Without memory | With memory |
|---|---|---|
| PRJ-A will miss its date | *"Rebalance capacity to EM-B"* | *"**Disclose the slip risk to merchants + exec committee within 48h (L-2)**, then rebalance capacity to EM-B"* |

L-2 exists because Release 15 slipped quietly and 1,100 merchants churned. The CEO's
words are in the record: *"The delay didn't cost us the merchants. Finding out in
February did."*

#### Governance — People Memory is the sharp edge

People Memory (coaching notes, working preferences) is personal data under **DPDPA**, so
`memory:personal` is a **separate, narrow permission** — it does not ride along with
general memory access. Enforced at the fabric, not the UI:

| Role | Sees | Denied |
|---|---|---|
| Deputy Chief | all 18 records | — |
| Auditor | 17 (decisions, journal) | People Memory (**audit scope ≠ HR data**) |
| VP – Operations | 14 | personal + restricted |

Withheld records are **reported, never silently dropped** (`"🔒 1 record redacted"`), so
the executive knows something exists without seeing it.

### The continuous core (`twin/`)

- **`model.ts` + `state.ts`** — the twin: projects, engineering managers, vendors,
  releases, channels, regulations, customer metrics. `evolveTwin()` advances the org
  on every beat (projects drift, vendor SLAs decay, complaints rise) so it is never
  static.
- **`offices.ts`** — 8 always-running AI Offices (Executive Intelligence, Strategy,
  Delivery, Engineering, People, Customer, Risk, Operations). Each returns a domain
  health score, **observations** ("AxisPay SLA declining"), and **predictions**
  ("UPI Autoscale likely to miss 2026-08-05").
- **`attention.ts`** — the **Executive Attention Engine**: ranks every observation by
  materiality × urgency, gives the executive the top ~3, delegates the mid-tier to a
  named owner, and silently handles the rest — and estimates the executive hours
  reclaimed.
- **`pulse.ts`** — the heartbeat: every 4s it evolves the twin, runs all Offices,
  optimizes attention, journals what it decided the executive must see, and fans the
  snapshot out over SSE. Runs with nobody watching.

## Production seams (swap without touching business logic)

| Seam | Default | Production |
|---|---|---|
| AI provider | `MockAiProvider` (offline) | `AzureOpenAiProvider` — set `EIOS_AI_PROVIDER=azure-openai`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` |
| Data store | in-memory `Store` | Cosmos DB / Azure SQL behind the same interface |
| Event bus | Node `EventEmitter` | Azure Event Grid / Service Bus |
| Auth | `x-eios-user` header | Entra ID JWT bearer validation |
| Audit sink | in-memory hash chain | append-only WORM storage |

Config: `server/src/config.ts` (all env-overridable).

## Project layout

```
eios-prototype/
  package.json          root scripts (dev/build/test via workspaces-style prefixing)
  server/               EIOS backend (TypeScript, Express, Vitest)
    src/
      domain/types.ts   shared domain model
      config.ts         env-driven config (incl. ₹10L limit)
      events/bus.ts     event backbone
      data/             seed scenario + store
      memory/           MEMORY FABRIC: model · fabric · seed · recall
      perception/       PERCEPTION: events · reducer · connectors
      governance/       rbac · guardrails · audit
      services/         decisions · delegations · signals
      cognitive/        aiProvider · commandService
      api/              routes · middleware
      __tests__/        24 tests
  web/                  EIOS web experience (React + Vite)
    src/                App.tsx · api.ts · types.ts · styles.css
```

## Test coverage highlights

`npm test` (**152 passing** — hygiene, *not* an architecture milestone; see the scorecard) covers: tier classification, the ₹10L hard-limit, ABAC
authority, four-eyes approver rules, decision resolution, the delegation state
machine and spend-cap rules, the One-Prompt→RBAC/guardrail path, audit-chain
integrity/immutability, the AI Offices' observations/predictions, severity-based
health scoring, the Attention Engine's ranking/triage, the Pulse heartbeat, the
event-sourcing reducer, ingestion validation, connector honesty (enterprise
connectors must report `not-configured` and emit nothing), and **29 memory tests**:
the full XYZ Bank recall (rationale, alternatives, blocking gap, verbatim commitment,
unmet revisit condition), causal-chain tracing, provenance on every claim, People
Memory redaction per role, memory refusing to guess, and **lessons changing what the
Offices recommend**; and **52 knowledge-platform tests**: weakest-link confidence,
per-kind aging (events never stale), assumption-breaking → validity degradation,
lineage invalidation propagation, the wisdom pipeline (no wisdom without a human),
conflict detection, auto-capture (and refusing to record noise), and the fabric
refusing to store bare records; and **24 platform tests**: append-only ordering,
durability across restart, corrupt-tail truncation, snapshot resume, replay determinism,
hash insensitivity to float noise but not to real change, time-travel stability, knowledge
replay, and the scorecard refusing to invent unmeasurable metrics.

Again: these prove the implemented behaviors work. They are not evidence of
production readiness.

## What remains (the honest roadmap)

Sequenced deliberately — **memory and context before reasoning**. A Brain with no
institutional history has nothing to think about.

| # | Program | Status | What's left |
|---|---|---|---|
| 1 | **Perception Layer** | Architecture **done** — event-sourced twin, connector interface, ingestion API, 4 typed enterprise connectors | Implement + credential the real Graph/DevOps/ServiceNow/Monitor integrations; security review |
| 2 | **Authoritative Twin** | Twin is a reducer over events | Backfill from systems of record; persistence, scale, replay; more entities |
| 3 | **Organizational Memory** | **Core built** — structured graph, provenance, timelines, causal trace, scars that change recommendations, DPDPA-governed People Memory, explainable recall | Persistence; richer capture rules |
| 3b | **Executive Knowledge Platform v1** | **Built** — temporal decisions w/ assumptions, org vs executive layers, lineage + invalidation propagation, multidimensional confidence, aging/supersession, wisdom pipeline w/ human approval, self-assessed quality, continuous evolution | Capture rules cover only 2 event kinds; pattern detection is a tag heuristic; no conflict *resolution* workflow |
| 3c | **Phase 2 · Event Store** | **Built** — durable append-only log, replay, verified determinism, time travel, knowledge replay, architecture scorecard | Knowledge fabric itself is still in-memory (only the *twin* replays); log is local-disk not Kafka/Event Hubs; no distribution, replication, retention, or compaction |
| 4 | **Executive Persona Engine** | ⬜ not started | Learn *this* executive: writing style, delegation preferences, escalation thresholds, risk appetite — learned, transparent, user-controlled, never hardcoded |
| 5 | **Relationship Intelligence** | Seeded only (`relationship` kind) | Stakeholder graphs, collaboration patterns, recurring friction, dependency mapping |
| 6 | **Executive Brain** | Rules-based offices; trend→prediction | Monte-Carlo → outcome probabilities, risk ranking, mitigation options; planning; policy validation. **Deferred until 1–5 give it something to reason over.** |
| 7 | **Meeting Representative** | ⬜ not started | Attend where authorized, answer within delegated authority, negotiate, commit only within policy, record rationale → memory |
| 8 | **Execution Fabric** | Delegation + guardrails + audit | Safe *write* actions into real systems within delegated authority |
| 9 | **Learning loop** | ⬜ not started | Expected vs. actual → policy refinement, constrained by governance and review |

Then, separately: load/resilience engineering, security review, DR, and regulatory
compliance.

### Phase 2 — what remains (the honest backlog)

| Program | Status |
|---|---|
| Durable event storage · replay · snapshotting | ✅ increment 1 |
| **Knowledge persistence** (the fabric still lives in memory — only the twin replays) | ⬜ next |
| Versioned knowledge (D-193 v1 → v2 → superseded) | ⬜ |
| Policy Engine (externalise governance; change policy without code) | ⬜ |
| Explainability Engine (recommendation → memory → events → reasoning path → counterfactuals) | ⬜ |
| Twin integrity self-check · Meta-reasoning | ⬜ |
| Observability · HA · DR · distributed processing · performance | ⬜ |
| Security hardening · compliance · operational tooling · multi-tenancy | ⬜ |

Almost none of that involves AI. That is the correct shape of the remaining work.

### Known limits of the knowledge platform (today)

Stated plainly, because a knowledge platform that hides its own gaps is the failure mode
it exists to prevent:

- **Partly seeded.** Auto-capture works (verified: a pushed ServiceNow breach becomes an
  institutional record), but capture rules cover only 2 event kinds. Meetings, emails and
  RCAs are still hand-authored — real accretion needs the live connectors.
- **The twin now persists and replays; the knowledge fabric does not.** Events are
  durable and the organization rebuilds itself on boot (verified across a process kill),
  but memory records still live in memory. That asymmetry is the next thing to fix.
- **The log is local-disk JSONL.** Real durability, but not Kafka/Event Hubs: no
  replication, partitioning, retention policy, or compaction.
- **Pattern detection is a tag heuristic.** Deliberately simple and inspectable because it
  proposes org policy — but it is not clustering, and it will miss non-obvious patterns.
- **Conflict detection, not resolution.** Contradictions mark both records disputed and
  cap confidence at 40%; a human must resolve them. There is no reconciliation workflow.
- **Deterministic recall.** Rules-based intent routing — deliberately, to prove the
  structure carries the answer. An LLM would improve phrasing and question coverage; it
  would *not* supply the facts.
- **Not yet hardened for production**: no observability/metrics on the knowledge layer, no
  API versioning, no load characterisation, no security review.
