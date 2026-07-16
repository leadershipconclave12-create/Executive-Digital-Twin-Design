# EIOS Architecture Specification

**The constitution of the Executive Intelligence Operating System.**
Status: **v1.0 — FROZEN** · Owner: Chief Platform Engineer · Frozen: July 2026

| | |
|---|---|
| **Companions** | `DOMAIN_MODEL.md` (the language) · `ENGINEERING_STANDARDS.md` (the rules) |
| **Supersedes** | Ad-hoc architecture decisions embedded in the 7-volume series |
| **Change control** | §11 — breaking this document requires justification against §10 |

---

## 1. What this document is

EIOS's architecture is **frozen at v1.0**. Not because the system is production-ready —
it is not — but because *the conceptual architecture is stable enough to stop redesigning
the core*. Further architectural invention would now improve the diagrams more than the
product.

From this point, every proposal is judged by **the freeze question** (§10):

> **Does this make the Deputy Chief's day measurably easier, or does it only make the
> architecture more sophisticated?**

This document defines what EIOS *is*, so that what comes next can be built on it rather
than around it.

---

## 2. Principles

These were derived from the system as built, not aspiration. They are ranked: when two
conflict, the higher wins.

| # | Principle | Consequence |
|---|---|---|
| **P1** | **Unknown beats guessed** | The platform reports gaps, redactions, and unmeasurable metrics rather than plausible fiction. One caught fabrication kills executive trust permanently. |
| **P2** | **The organization is the center, not the prompt** | EIOS is push, not pull. It runs whether or not anyone is looking. "One Prompt" interrogates a system that already did the work. |
| **P3** | **The log is the system of record; everything else is derived** | Twin, health, attention and quality are *materialized views*. If it isn't in the log, it didn't happen. |
| **P4** | **The system proposes; a human disposes** | No AI inference becomes organizational policy without named human approval. |
| **P5** | **Knowledge is temporal** | Nothing is true forever. Records age, decisions rest on assumptions that break, foundations get superseded. |
| **P6** | **Provenance or it didn't happen** | Every claim names its source and epistemic status (`stated`/`derived`/`inferred`). |
| **P7** | **Governance lives in the domain, not the UI** | Every rule must hold when the UI is bypassed. The conversational surface obeys the same checks as the API. |
| **P8** | **Confidence is explained, not asserted** | No scalar confidence: dimensions + what limits the score. |
| **P9** | **The executive's attention is the scarcest resource** | Optimizing it is the product. Everything else is plumbing. |
| **P10** | **Seams over integrations** | Every external dependency sits behind an interface that can be swapped without touching business logic. |

---

## 3. Bounded contexts

Eight contexts. Each owns its data and may be understood in isolation.

```
┌─────────────────────────────────────────────────────────────────┐
│  EXPERIENCE            web/  — ECC · Pulse · One Prompt · Memory │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP /api  (+ SSE)
┌───────────────────────────────▼─────────────────────────────────┐
│  API                   api/  — auth (single user) · routes        │
└───────────────────────────────┬─────────────────────────────────┘
                ┌───────────────┼───────────────┬─────────────┐
                ▼               ▼               ▼             ▼
        ┌──────────────┐ ┌───────────┐  ┌────────────┐ ┌───────────┐
        │  COGNITIVE   │ │  SERVICES │  │    TWIN    │ │GOVERNANCE │
        │ commandSvc   │ │ decisions │  │  offices   │ │ rbac      │
        │ aiProvider ⟿ │ │ delegations│ │  attention │ │ guardrails│
        │  (seam)      │ │ signals   │  │  pulse     │ │ audit     │
        └──────┬───────┘ └─────┬─────┘  └──────┬─────┘ └─────┬─────┘
               │               │               │             │
               └───────────────┴───────┬───────┴─────────────┘
                                       ▼
                         ┌─────────────────────────┐
                         │  KNOWLEDGE              │
                         │  confidence · lifecycle │
                         │  lineage · wisdom       │
                         │  quality · evolution    │
                         └───────────┬─────────────┘
                                     ▼
                         ┌─────────────────────────┐
                         │  MEMORY  (the fabric)   │
                         │  structured graph       │
                         └───────────┬─────────────┘
                                     ▼
                         ┌─────────────────────────┐
                         │  PERCEPTION             │
                         │  connectors ⟿ (seams)   │
                         │  events · reducer       │
                         │  OWNS THE TWIN STATE    │
                         └───────────┬─────────────┘
                                     ▼
                         ┌─────────────────────────┐
                         │  PLATFORM               │
                         │  eventStore (log) ⟿     │
                         │  replay · metrics       │
                         └─────────────────────────┘
```

### Dependency rules

1. **Downward only.** A context may depend on those below it, never above.
2. **Perception is the sole mutator of the Twin.** Every other context reads it.
3. **Platform depends on nothing.** The log has no knowledge of what it stores.
4. **Governance is called by everyone and calls no one** (except the audit bus).
5. **The Experience layer holds no business rules.** Bypassing it must change nothing.

> **Known weakness (F9).** These rules are upheld by **convention and review, not by the
> type system or a fitness test.** Nothing mechanically prevents an Office from mutating
> the Twin. This is the highest-priority architectural hygiene item, deliberately not
> fixed before the freeze.

### Context responsibilities

| Context | Owns | Must never |
|---|---|---|
| **Platform** | The immutable event log, replay, determinism, scorecard | Interpret event semantics |
| **Perception** | `TwinState`, connectors, the reducer | Invent state it did not observe |
| **Memory** | The knowledge graph, provenance, governance-gated visibility | Store a record without provenance |
| **Knowledge** | Confidence, lifecycle, lineage, wisdom, quality, evolution | Promote wisdom without a human |
| **Twin** | Offices, observations, predictions, attention, the heartbeat | Mutate the Twin |
| **Services** | Decisions, delegations, signals | Bypass guardrails |
| **Cognitive** | Intent routing, the AI provider seam | Exceed guardrails; leak personal data to a model |
| **Governance** | Identity, ABAC ceiling, guardrails, the audit chain | Be optional |
| **API** | Auth, transport | Contain business rules |

---

## 4. The core inversion

The single decision this architecture rests on:

```
Event → Immutable Log → Replay → Materialized Views → Organizational Twin
```

The Twin is not state that events mutate. It is a **derived view of the log**.

**Why it matters:** durability, replay, rebuild, time travel, full input audit, and the
ability to run tomorrow's reasoning against yesterday's organization — all fall out of
one choice rather than being built one at a time.

**Verified property:** replaying identical history reconstructs byte-identical
organizational state (`verifyDeterminism`, checked at every boot). If this ever fails,
audit, time travel and knowledge replay are void — so the platform *checks* it rather
than trusting it.

---

## 5. Data contracts

Three contracts are load-bearing. Changing any is a breaking change (§11).

### 5.1 `OrgEvent` — the only way the world enters EIOS

```ts
interface OrgEvent {
  id: string
  source: 'synthetic' | 'ms-graph' | 'azure-devops' | 'servicenow' | 'azure-monitor' | 'webhook'
  kind: 'project.progress' | 'project.risk' | 'channel.metric' | 'vendor.sla'
      | 'vendor.renewal' | 'release.signal' | 'comms.signal' | 'customer.metric'
  at: string          // when it HAPPENED
  entityId: string    // must resolve to a known twin entity, or it is rejected
  data: Record<string, number | string | boolean>
}
```

**Invariants:** immutable · rejected if `entityId` is unknown · logged before the Twin
acknowledges it · ordering by `seq` is the truth.

### 5.2 `MemoryNode` — the unit of institutional knowledge

Every node carries `layer` · `lifecycle` · `confidence` · `provenance` · `sensitivity`.
`fabric.add()` **refuses bare records** — normalization on write is what makes a record
knowledge rather than data.

### 5.3 `PulseSnapshot` — what the organization looks like right now

`{tick, at, offices[], organizationHealth, attention{forExecutive,delegated,handled}, predictions[], perception{}}`
Emitted every heartbeat over SSE. Ephemeral — **not** in the log (see §8, known gap).

---

## 6. Event model

| Aspect | Decision |
|---|---|
| **Ingress** | Connectors poll; external systems `POST /api/events` |
| **Validation** | At the boundary (`validateEvent`); unknown kinds/entities rejected with a reason |
| **Ordering** | Monotonic `seq` assigned at append |
| **Durability** | Append-only JSONL, `fsync` per append, corrupt-tail truncation |
| **Delivery** | In-process; at-most-once |
| **Replay** | Fold `applyEvent` over the log from seed or snapshot |
| **Snapshots** | Every 60s; replay resumes from `snapshot.seq + 1` |
| **Retention** | ⬜ None. The log grows forever. **Known gap.** |
| **Notification** | A separate in-process bus (`DomainEvent`) — *not* the log. Do not conflate. |

---

## 7. Security model

| Layer | Mechanism | Status |
|---|---|---|
| **Authentication** | Resolves to the single user unconditionally | ❌ **None.** Whoever reaches the port is the Deputy Chief. Fine on localhost; the Entra ID JWT seam is `authenticate()`. |
| **Authorization (RBAC)** | — | ⬜ **Removed (ADR-010).** One user; a gate that cannot deny is theatre. |
| **Authorization (ABAC)** | `canUserApprove` — the executive's own ₹5Cr ceiling | ✅ Enforced — single user ≠ unlimited |
| **LLM egress** | `LLM_ACCESS` withholds personal/restricted from prompts | ✅ Enforced at context assembly |
| **Autonomy limit** | ₹10L hard cap (ADR-003), regardless of tier/confidence | ✅ Enforced |
| **Personal data** | Never enters an LLM prompt; PII regex-redacted before egress; withholding **reported** | ✅ Enforced at the fabric |
| **Audit** | SHA-256 hash-chained journal; `verify()` re-derives | ✅ Enforced |
| **Secrets** | Env vars | 🟡 Production: Key Vault |
| **Transport** | Plain HTTP, permissive CORS | ❌ **Not production-safe** |

**The governance guarantee:** every rule is enforced in the domain, not the UI. The
One-Prompt conversational surface runs through the *same* RBAC and guardrail path as the
REST API — it cannot exceed the executive's authority.

---

## 8. Failure modes

Stated honestly. An architecture document that omits how the system fails is marketing.

| # | Failure | Behaviour today | Severity |
|---|---|---|---|
| FM1 | **Connector throws** | Caught per-connector; perception continues | ✅ Contained |
| FM2 | **Corrupt log tail** (torn write on crash) | Truncates at last good record, warns | ✅ Contained |
| FM3 | **Bad snapshot** | Falls back to full replay from seq 0 | ✅ Contained |
| FM4 | **Disk full / log append fails** | **Throws; event lost; twin may diverge from log** | ❌ **Unhandled** |
| FM5 | **Process crash mid-beat** | Twin rebuilt from log on boot; in-flight beat lost | 🟡 Acceptable |
| FM6 | **Knowledge fabric lost on restart** | **Total loss — the fabric is in-memory** | ❌ **The asymmetry**: the twin replays, memory does not |
| FM7 | **Log grows unbounded** | No retention/compaction; boot time grows linearly | 🟡 Snapshots mitigate |
| FM8 | **Two instances, one log** | **Undefined.** No locking, no leader election | ❌ Single-instance only |
| FM9 | **Determinism violated** | Reported at boot and in the scorecard; **not blocked** | 🟡 Detected, not prevented |
| FM10 | **AI provider unavailable** | Mock default never fails; Azure path throws unhandled | 🟡 |
| FM11 | **Clock skew** | Time-travel and staleness rely on `at`; no monotonic guard | 🟡 |

**FM6 and FM8 are the two that disqualify production deployment today.**

---

## 9. Extension points

Where future work plugs in **without** breaking the freeze. Each is a seam that already
exists.

| Extension | Seam | Notes |
|---|---|---|
| **Real enterprise integrations** | `Connector` interface | Four typed connectors exist and emit nothing without credentials. Implement `poll()`. |
| **Real LLM** | `AiProvider` interface | `EIOS_AI_PROVIDER=azure-openai`. Business logic untouched. |
| **Durable log at scale** | `EventStore` append/read contract | Swap JSONL → Kafka / Event Hubs. Same contract. |
| **Persistent knowledge** | `MemoryFabric` | The graph is behind one class. |
| **Persistent twin state** | `Store` / reducer | Already event-sourced; add a materialized store. |
| **Policy Engine** | `guardrails.ts` pure functions | Currently hardcoded. Externalising them is F4. |
| **Executive Brain** | `Office.run(twin)` | Offices already consult Memory for precedent. |
| **Executive Identity** | `JudgmentMemory` (layer: `executive`) | The seed exists. See below. |

### 9.1 Executive Identity — the one deferred capability

The single architectural capability still missing, **intentionally postponed**:

> Why does this Digital Twin behave like *this* Deputy Chief and not another one?

Not authentication. Not persona mimicry of tone. **Encoding executive judgment in a
governed, explainable way**: decision philosophy, delegation habits, preferred trade-offs,
escalation thresholds, strategic priorities.

The architecture already anticipates it: `JudgmentMemory` (layer `executive`, `heldBy`,
`because`) is the seed. Generalising to a full Executive Identity requires **no schema
change to the frozen model** — which is the test of whether a freeze was drawn in the
right place.

**Deferred because:** it fails the freeze question *today*. With one executive, hardcoded
thresholds behave identically to learned ones. It becomes essential when (a) EIOS serves
a second executive, or (b) the Brain starts making judgement calls the executive would
have made differently.

---

## 10. The freeze question

Every proposal from v1.0 onward is judged by:

> **Does this make the Deputy Chief's day measurably easier, or does it only make the
> architecture more sophisticated?**

If it does not **reduce cognitive load**, **improve decision quality**, or **safely
automate executive work**, it belongs in the backlog — not the core platform.

Applied to the nine defects in `DOMAIN_MODEL.md §4`:

| Passes (the executive feels it) | Fails today (architecture only) |
|---|---|
| **F1** Decision modelled twice → today's decisions never become tomorrow's memory | F3 "Event" overloaded (language hygiene) |
| **F4** Policy hardcoded → governance can't change without a deploy | F9 Context boundaries conventional |
| **F5** Recommendation has no provenance → violates S1; unaccountable advice | F7 Goal/OKR (no user asking yet) |
| **F2** Risk is not an entity → the Risk Office cannot operate | F8 Escalation as enum |
| **FM6** Knowledge lost on restart → the org forgets what it learned | F6 Commitment anonymous |

**Recommended order:** FM6 → F1 → F5 → F4 → F2. Everything else waits.

---

## 10a. ADR-010 - Collapse to a single user (v1.1, BREAKING)

**Context.** EIOS was built with five roles (Deputy Chief, Chief of Staff, VP Operations,
Compliance Officer, Auditor), an RBAC permission matrix, and an "Acting as" switcher.
The product decision is that EIOS serves **exactly one person: the Deputy Chief
(Products)**. Nobody else logs in.

**Decision.** Remove the role system. Not disable it - remove it.

**Why remove rather than keep a stub.** With one user, `requirePermission()` can never
deny. A permission gate that always returns true is theatre: it makes the architecture
look sophisticated while enforcing nothing, and it invites the next reader to trust a
boundary that does not exist. Deleting it is the honest act. (This is the "architecture
for architecture's sake" failure the freeze exists to prevent.)

**What did NOT go away.** The governance that actually binds an executive AI was never
human-vs-human. It is:

| Boundary | Where | Status |
|---|---|---|
| **EIOS vs the executive** - the Rs 10L autonomous hard-limit, autonomy tiers, confidence floor | `governance/guardrails.ts` | Unchanged |
| **The executive vs his own ceiling** - Rs 5Cr, above which it goes to the Board | `canUserApprove` | Unchanged |
| **This machine vs the model** - what may enter a prompt | `memory/fabric.ts`, `llm/redact.ts` | **Strengthened** |
| **Now vs later** - the immutable audit journal | `governance/audit.ts` | Unchanged |

**The repurposing.** `Sensitivity` (open/restricted/personal) stopped being *"who may see
this"* and became *"what may leave this machine"*:

- `HUMAN_ACCESS` - the executive. Sees everything. It is his organization, his notes.
- `LLM_ACCESS` - a prompt bound for an external model. Personal and restricted records
  are withheld, however useful they would be.

This is a **stronger** boundary than the one it replaced, because it is the one that can
actually be violated: an LLM call crosses a network and a company boundary; a local read
does not. Verified: `PE-B` (1:1 coaching notes) -> `sentToLlm: false`; `D-193` (a decision
record) -> `sentToLlm: true`. The gate is enforced at context assembly, not by asking the
model nicely.

**Consequences.**
- `Role` collapses to `'deputy_chief'`. Kept as a type so the audit journal records a
  typed actor and the Entra ID seam has a shape.
- `Permission`, `ROLE_PERMISSIONS`, `can()`, `memoryAccessFor()`, `requirePermission()` - deleted.
- `DecisionItem.requiredApprovers` becomes `string[]`: humans **outside** EIOS whose
  sign-off is needed (e.g. "Risk / Compliance sign-off"). They are not users.
- Delegates ("VP - IT Operations") are **recipients of work, not users**. They never log
  in. That is why they are strings.
- **`authenticate()` now resolves to the Deputy Chief unconditionally.** Anyone who can
  reach the port *is* him. Acceptable for a localhost tool; **not** acceptable the moment
  it is exposed. See section 7.

**Rejected alternative.** Keep RBAC "for when more roles arrive." Rejected: speculative
generality, and it would leave a dead boundary that reads as a live one.

---

## 11. Change control

Frozen at v1.0. The following require an ADR, justification against §10, and a version
bump — they are **breaking**:

- Renaming or removing a concept in `DOMAIN_MODEL.md`
- Changing an invariant or its owner
- Altering `OrgEvent`, `MemoryNode`, or `PulseSnapshot` contracts
- Weakening any Engineering Standard
- Adding a dependency that violates §3

The following are **non-breaking** and encouraged:
implementing a seam (§9), fixing a conformance violation, adding a connector, adding
tests, improving observability.

> **Rule.** The documents may never lag the code. A change that alters the domain updates
> `DOMAIN_MODEL.md` *in the same change*, or it is not complete.

---

## 12. Honest status

| Layer | Maturity |
|---|---|
| Vision | ~100% |
| Architecture (this document) | **Frozen v1.0** |
| Domain model | 95% — 9 known defects, recorded |
| Knowledge platform | 92% |
| Executive twin | ~70% |
| **Enterprise production** | **~35%** |

**EIOS Architecture v1.0 is complete. EIOS the product is not.**

The remaining work is overwhelmingly *not* AI: durability, observability, HA, DR,
security hardening, compliance, operational tooling, performance. That is the normal shape
of a platform after its architecture stabilises — and it is the phase where projects with
excellent architecture most often die, by never transitioning from architecture to
product.

*Document owner: Chief Platform Engineer · EIOS Architecture Specification v1.0 · FROZEN July 2026*
