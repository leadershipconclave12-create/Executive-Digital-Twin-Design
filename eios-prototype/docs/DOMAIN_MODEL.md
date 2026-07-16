# EIOS Domain Model

**The language of the platform.**
Status: **v1.0 — Frozen** · Owner: Chief Platform Engineer · Last reviewed: July 2026

---

## Purpose

This document defines every core concept in EIOS: what it *is*, what it holds, how it
lives and dies, what it relates to, who owns it, and what must always be true of it.

It is the **ubiquitous language**. A concept that is not in this document does not exist
in EIOS. A concept that is in this document must be spelled the same way in code, API,
and conversation.

> **This document was written against the code, not against intent.** Each concept
> carries a **Status** field stating whether it is genuinely first-class, partially
> modelled, or absent. Writing it exposed **eight real defects** — recorded in
> §4 *Findings* rather than quietly fixed, because the point of a freeze is to know what
> you actually have.

**Legend for Status**

| | Meaning |
|---|---|
| ✅ **First-class** | Named type, owned by one context, invariants enforced in code |
| 🟡 **Partial** | Exists but is anonymous, duplicated, or its invariants are unenforced |
| ⬜ **Absent** | Named in the domain but not modelled — a known gap, not a surprise |

---

## 1. Concept map

```
                          ┌──────────────┐
                          │  Executive   │ ── holds ──► Judgment ──► (Executive Identity ⬜)
                          └──────┬───────┘
                                 │ is served by
                          ┌──────▼───────┐
                          │ Organization │🟡
                          └──────┬───────┘
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        ┌──────────┐      ┌───────────┐      ┌───────────┐
        │Department│      │  Project  │      │  Vendor   │
        │ (Office) │      └─────┬─────┘      └─────┬─────┘
        └──────────┘            │                  │
                                ▼                  ▼
                          ┌───────────┐      ┌───────────┐
                          │ Incident  │      │Relationship│
                          └─────┬─────┘      └───────────┘
                                │ produces
                                ▼
   Event ──► Memory ──► Lesson ──► Wisdom          Risk ⬜
     │         │          ▲
     │         │          │ learned from
     │         ▼          │
     │     Decision ──► Assumption ──► Validity
     │         │
     │         ├──► Commitment 🟡
     │         └──► Recommendation 🟡 ──► Attention ──► Escalation ⬜
     │
     └──► (immutable log) ──► Replay ──► Twin

  Policy ⬜ ····· governs everything above (currently hardcoded in guardrails)
  Goal ⬜ / OKR ⬜ ····· not modelled
```

---

## 2. Core concepts

### 2.1 Executive

**The** human EIOS serves. **Exactly one: the Deputy Chief (Products).** (ADR-010)
Delegates receive work; they never log in, and are therefore not users.

| | |
|---|---|
| **Status** | 🟡 Partial — modelled as `User`, an *authorization* subject, not an *identity* |
| **Type** | `domain/types.ts › User` |
| **Owner** | Governance context |
| **Attributes** | `id`, `name`, `role` (always `'deputy_chief'`), `title`, `financialAuthorityInr` |
| **Cardinality** | **1.** There are no other users. |
| **Lifecycle** | Static. No creation/retirement flow. |
| **Relationships** | *holds* → Judgment · *delegates* → Delegation · *decides* → Decision · *receives* → Attention |
| **Invariants** | May never approve beyond `financialAuthorityInr` (**enforced**: `canUserApprove`). Single user does NOT mean unlimited: Rs 6Cr still exceeds his Rs 5Cr ceiling and goes to the Board. |

> **Gap (now sharper).** With the role system gone, `User` is little more than a name and
> a spend ceiling. Nothing captures decision philosophy, risk appetite, or escalation
> thresholds. Collapsing to one user makes **Executive Identity** the obvious next
> capability rather than a nice-to-have — the whole product is now *this* person.
> Still deferred (ARCHITECTURE.md §9.1); `JudgmentMemory` remains its seed.

---

### 2.2 Organization

The enterprise EIOS observes. The subject of the Digital Twin.

| | |
|---|---|
| **Status** | 🟡 Partial — exists only as `TwinState`, a *bag of collections*, not an entity |
| **Type** | `twin/model.ts › TwinState` |
| **Owner** | Perception context (**sole** mutator) |
| **Attributes** | `tick`, `startedAt`, `lastTickAt`, + collections: projects, managers, vendors, releases, channels, regulations, customer |
| **Lifecycle** | Seeded → mutated **only** by `applyEvent` → rebuilt by replay |
| **Relationships** | *contains* → Department, Project, Vendor, Incident, Channel |
| **Invariants** | 1. Changes **only** via `applyEvent` (**enforced** — sole mutation path)<br>2. Replay of identical history yields an identical Organization (**enforced** — `verifyDeterminism`)<br>3. Runtime metadata (`tick`, `lastTickAt`) is **not** organizational state and is excluded from the state hash (**enforced**) |

> **Note.** `TwinState` has no identity, name, or version. It is implicitly "the one bank".
> Acceptable in v1.0 (single-tenant); would need to become a real entity for multi-tenancy.

---

### 2.3 Department (Office)

An organizational function. In EIOS, each is staffed by an **AI Office** that runs
continuously.

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `twin/model.ts › OfficeId`, `twin/offices.ts › Office` |
| **Owner** | Twin context |
| **Attributes** | `id`, `name`, `observes` (charter), health: `score`, `band`, `headline` |
| **Members** | `executive-intelligence`, `strategy`, `delivery`, `engineering`, `people`, `customer`, `risk`, `operations` |
| **Lifecycle** | Static set. Runs every heartbeat. Stateless between beats. |
| **Relationships** | *produces* → Observation, Prediction · *consults* → Lesson, Judgment |
| **Invariants** | 1. An Office **reads** the Twin; it may never mutate it (**enforced by convention**, not by types — see Findings F7)<br>2. Health is scored on **severity**, not raw metric value (**enforced**: a critical channel scores 35, not its 84.5% rate) |

---

### 2.4 Project

A unit of delivery.

| | |
|---|---|
| **Status** | ✅ First-class (dual representation, intentionally) |
| **Types** | `twin/model.ts › Project` (live state) · `memory/model.ts › ProjectMemory` (history) |
| **Owner** | Perception owns live state; Memory owns history |
| **Attributes (live)** | `id`, `name`, `completion`, `plannedCompletion`, `riskScore`, `deadline`, `em` |
| **Attributes (history)** | `entityRef`, `milestones[]`, `blockers[]`, `lessonsLearned[]` |
| **Lifecycle** | Live: continuously updated by `project.progress` / `project.risk` events. History: appended, never rewritten. |
| **Relationships** | *owned by* → EngineeringManager · *about* → ProjectMemory · *depends_on* → Decision |
| **Invariants** | `completion` and `riskScore` ∈ [0,100] (**enforced** — reducer clamps) |

> The live/historical split is **deliberate and correct**: "where is PRJ-A now" and "what
> has PRJ-A been through" are different questions with different decay characteristics.

---

### 2.5 Decision

A choice made in the organization. **The most important concept in EIOS — and the most
broken.**

| | |
|---|---|
| **Status** | 🟡 Partial — **modelled twice, in two contexts, with no link between them** |
| **Types** | `domain/types.ts › DecisionItem` (operational queue) · `memory/model.ts › DecisionMemory` (institutional record) |
| **Owner** | Split — Services owns the queue; Memory owns the record |

**`DecisionItem`** (what needs deciding now)

| | |
|---|---|
| **Attributes** | `id`, `type`, `domain`, `tier`, `risk`, `summary`, `recommendation`, `amountInr`, `confidence` *(scalar!)*, `status`, `requiredApprovers`, `decidedBy`, `decidedAt`, `rationale` |
| **Lifecycle** | `pending → approved \| rejected \| auto-executed` |
| **Invariants** | 1. Autonomous execution requires tier=Autonomous ∧ amount < ₹10L ∧ confidence ≥ 0.85 (**enforced**: `evaluateAutoExecution`)<br>2. Resolution requires the actor's authority ≥ amount (**enforced**: `canUserApprove`)<br>3. A resolved decision cannot be re-resolved (**enforced**) |

**`DecisionMemory`** (what was decided, and whether it still holds)

| | |
|---|---|
| **Attributes** | `outcome`, `rationale[]`, `alternatives[]`, `approvals[]`, `commitments[]`, `assumptions[]`, `revisitWhen`, `reopenedAt`, `realized` |
| **Lifecycle** | Recorded → assumptions tested → `holds → at_risk → invalid` → superseded |
| **Invariants** | 1. Validity is **derived** from assumptions, never asserted (**enforced**: `validityOf`)<br>2. Every rationale is traceable to provenance (**enforced**) |

> **DEFECT F1.** `DecisionItem` and `DecisionMemory` are the *same domain concept* in two
> shapes with **no relation between them**. Approving `DT-007` in the queue creates no
> `DecisionMemory`. The institutional record and the operational record are disconnected —
> so today's decisions do not become tomorrow's memory. This is the single most important
> defect the freeze exposed.

---

### 2.6 Assumption

A load-bearing belief a Decision rests on. **The concept that makes decisions temporal.**

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `memory/model.ts › Assumption` |
| **Owner** | Memory context |
| **Attributes** | `id`, `text`, `status`, `brokenBy`, `checkedAt` |
| **Lifecycle** | `unverified → holds \| broken`. Terminal at `broken`. |
| **Relationships** | *belongs to* → Decision · *broken by* → Event/Memory node (`invalidates` edge) |
| **Invariants** | 1. A broken assumption **must** name what broke it (**enforced**: `breakAssumption` sets `brokenBy`)<br>2. Breaking an assumption **must** degrade the parent Decision's Validity (**enforced**: `validityOf` derives) |

---

### 2.7 Validity

The current standing of a Decision. Derived, never stored.

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `memory/model.ts › Validity = 'holds' \| 'at_risk' \| 'invalid'` |
| **Owner** | Knowledge context (`lifecycle.ts › validityOf`) |
| **Lifecycle** | Recomputed on read. Never persisted. |
| **Invariants** | 1. ≥1 broken assumption ⇒ at least `at_risk`; ≥2 ⇒ `invalid` (**enforced**)<br>2. Validity is **never** set by hand (**enforced** — no setter exists) |

---

### 2.8 Risk

| | |
|---|---|
| **Status** | ⬜ **Absent as an entity** |
| **Reality** | Scattered across three unrelated shapes: `RiskLevel` (a decision attribute), `riskScore: number` (on Project/Release), and `InvalidationRisk` (a lineage finding) |
| **Owner** | — |
| **Invariants** | None. Nothing enforces that a risk has an owner, a mitigation, or a review date. |

> **DEFECT F2.** Risk is an adjective in EIOS, not a noun. A bank cannot run a Risk Office
> on `riskScore: 61`. A real `Risk` entity needs: owner, likelihood, impact, mitigation,
> review date, acceptance, and a lifecycle (`identified → assessed → mitigated → accepted → closed`).

---

### 2.9 Incident

An operational failure event.

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `domain/types.ts › Incident` |
| **Owner** | Services context |
| **Attributes** | `id`, `severity` (P1/P2/P3), `title`, `service`, `openedAt`, `owner`, `status`, `customerImpact` |
| **Lifecycle** | `Investigating → Mitigating → Monitoring → Resolved` |
| **Relationships** | *caused by* → Vendor/System · *delegated as* → Delegation · *becomes* → Memory (`event` kind) |
| **Invariants** | None enforced — status transitions are unguarded (cf. Delegation, which *is* guarded). **Inconsistency.** |

---

### 2.10 Lesson

Institutional scar tissue. What the organization learned, and what it cost.

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `memory/model.ts › LessonMemory` |
| **Owner** | Knowledge context |
| **Attributes** | `rule`, `scar`, `learnedFrom[]`, `triggerTags[]`, `appliesWhen`, `active`, `approvedBy`, `approvedAt` |
| **Lifecycle** | `WisdomCandidate → (human approves) → active Lesson → stale → superseded` |
| **Relationships** | *learned from* → Event · *constrains* → Project/Release · *cited by* → Prediction.precedent |
| **Invariants** | 1. A Lesson **must** carry its scar — the cost that taught it (**enforced by type**)<br>2. A Lesson **must** be human-approved to become active (**enforced**: only `WisdomEngine.approve` creates one)<br>3. Superseded/obsolete Lessons **must not** steer live recommendations (**enforced**: `lessonsFor` filters on lifecycle) |

---

### 2.11 Wisdom (WisdomCandidate)

A proposed Lesson, awaiting a human. **The system proposes; a human disposes.**

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `memory/model.ts › WisdomCandidate` |
| **Owner** | Knowledge context (`wisdom.ts › WisdomEngine`) |
| **Attributes** | `proposedRule`, `pattern`, `occurrences[]`, `occurrenceCount`, `status`, `proposedAt`, `reviewedBy`, `reviewedAt`, `triggerTags`, `scar` |
| **Lifecycle** | `candidate → approved \| rejected`. Terminal at both. |
| **Invariants** | 1. Requires ≥3 occurrences to be proposed (**enforced**) — twice is a coincidence<br>2. A candidate **must not** influence any recommendation before approval (**enforced**: it is not a Lesson until promoted)<br>3. Approval **must** be attributed to a named human (**enforced**)<br>4. Approval requires `decision:approve` — setting policy is an executive act, not a memory read (**enforced** at the route) |

---

### 2.12 Memory (MemoryNode)

The base unit of institutional knowledge.

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `memory/model.ts › MemoryNode` |
| **Owner** | Memory context |
| **Attributes** | `id`, `kind`, `layer`, `title`, `at`, `summary`, `tags`, `provenance`, `sensitivity`, `lifecycle`, `confidence`, `validUntil?`, `lastVerifiedAt?`, `supersededBy?`, `supersedes?` |
| **Kinds** | decision · meeting · project · person · relationship · strategic · event · lesson · judgment |
| **Layers** | `organizational` (facts the org knows) · `executive` (judgment this executive holds) |
| **Lifecycle** | `active → stale → superseded \| obsolete → archived`; `awaiting_validation` for proposals |
| **Invariants** | 1. Every node **must** have provenance (**enforced**: `fabric.add` normalizes)<br>2. Every node **must** have a layer, lifecycle, and computed confidence (**enforced**: `fabric.add` refuses bare records)<br>3. Confidence follows **provenance**, not the author's optimism (**enforced**: `derived` ⇒ unvalidated)<br>4. `personal` nodes require `memory:personal`; redactions are **reported**, never silent (**enforced**: `fabric.visible` + `countRedacted`)<br>5. An `event` node **never** goes stale — history does not expire (**enforced**: per-kind decay) |

---

### 2.13 Event

**The most overloaded word in the platform.**

| | |
|---|---|
| **Status** | 🟡 Partial — **four unrelated types share the name** |

| Type | Meaning | Owner |
|---|---|---|
| `OrgEvent` | A normalized observation of the organization | Perception |
| `StoredEvent` | An `OrgEvent` + `seq`/`storedAt`, in the immutable log | Platform |
| `DomainEvent` | An in-process pub/sub message | Events (bus) |
| `AuditEvent` | A hash-chained journal entry | Governance |
| `MemoryNode(kind:'event')` | An institutional episode | Memory |

**`OrgEvent`** — the canonical one

| | |
|---|---|
| **Attributes** | `id`, `source`, `kind`, `at`, `entityId`, `data` |
| **Kinds** | `project.progress` · `project.risk` · `channel.metric` · `vendor.sla` · `vendor.renewal` · `release.signal` · `comms.signal` · `customer.metric` |
| **Lifecycle** | Emitted → validated → applied → **appended to the immutable log** → never modified |
| **Invariants** | 1. **Immutable.** Corrections are new events, never edits (**enforced**: append-only store)<br>2. Events for unknown entities are **rejected, not invented** (**enforced**: reducer returns false)<br>3. Ordering by `seq` is the truth (**enforced**: monotonic)<br>4. An event that reached the Twin **must** be replayable (**enforced**: logged before acknowledgement) |

> **DEFECT F3.** Five concepts named "Event" is a language failure. `OrgEvent` should be
> **Observation**; `DomainEvent` should be **Notification**; `MemoryNode(kind:'event')`
> should be **Episode**. Renaming is breaking — recorded, not done.

---

### 2.14 Policy

The rules that govern autonomous action.

| | |
|---|---|
| **Status** | ⬜ **Absent** — zero type definitions |
| **Reality** | Governance is **hardcoded** across `guardrails.ts` (₹10L limit, confidence threshold, tier rules), `rbac.ts` (`ROLE_PERMISSIONS`), and route decorators |
| **Invariants** | The ₹10L limit *is* enforced — but as a `config` number read by a function, not as an evaluable policy |

> **DEFECT F4.** Changing governance requires a code change and a deploy. In a bank,
> policy changes on a regulator's timeline, not a release train. A `Policy` entity + a
> Policy Decision Point is the correct shape (`ARCHITECTURE.md §9`, deferred).

---

### 2.15 Attention

The scarcest resource in the system: the Executive's hours.

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `twin/model.ts › AttentionItem` |
| **Owner** | Twin context (`attention.ts`) |
| **Attributes** | `id`, `office`, `title`, `why`, `score`, `disposition`, `recommendedAction`, `delegateTo?` |
| **Dispositions** | `executive` (needs the human) · `delegated` (has an owner) · `handled` (silent) |
| **Lifecycle** | Computed per heartbeat from Observations. **Ephemeral — not persisted.** |
| **Relationships** | *derived from* → Observation · *judged by* → AttentionFeedback |
| **Invariants** | 1. Score = materiality × urgency (**enforced**)<br>2. At most `execCap` (default 3) items reach the Executive (**enforced**)<br>3. The same item is journalled **once**, not every heartbeat (**enforced**: dedupe) |

> **Gap.** Attention is recomputed each beat and never stored, so "what did EIOS surface
> last Tuesday?" is unanswerable. Attention items are *not* in the event log.

---

### 2.16 Recommendation

What EIOS advises.

| | |
|---|---|
| **Status** | 🟡 Partial — **a bare `string`** |
| **Reality** | `Prediction.recommendation: string` and `DecisionItem.recommendation: string` |
| **Invariants** | **None.** A recommendation has no id, no provenance, no confidence dimensions, no alternatives, and no link to the evidence behind it. |

> **DEFECT F5.** This directly violates Engineering Standard S1 (*every recommendation
> must have provenance*). The `Prediction.precedent[]` field is the only trace, and it is
> optional. A recommendation should be an entity: `{id, text, basis[], confidence,
> alternatives[], policy[], counterfactuals[]}`.

---

### 2.17 Commitment

A promise a person made.

| | |
|---|---|
| **Status** | 🟡 Partial — **an anonymous inline type, defined twice, incompatibly** |
| **Reality** | `DecisionMemory.commitments: {who, text, condition?}[]` · `MeetingMemory.commitments: {who, text, status}[]` |
| **Invariants** | None enforced. One shape tracks `status`, the other tracks `condition`; neither tracks both. |

> **DEFECT F6.** *"We'll revisit after NPCI publishes the new circular"* is one of the most
> valuable things in the fabric — and it is stored in an unnamed object literal with no
> id, no owner, no due date, and no completion tracking. Commitment deserves to be an
> entity.

---

### 2.18 Relationship

| | |
|---|---|
| **Status** | 🟡 Partial — the word means two different things |
| **Reality** | `MemoryRelation` (a typed graph edge) vs `MemoryNode(kind:'relationship')` (a record *about* a stakeholder relationship) |
| **Owner** | Memory context |
| **Edge types** | `caused` · `led_to` · `evidence_for` · `decided_in` · `about` · `learned_from` · `constrains` · `supersedes` · `blocked_by` · `depends_on` · `contradicts` · `invalidates` |
| **Invariants** | 1. Every edge **must** carry provenance (**enforced by type**)<br>2. `depends_on` forms the lineage DAG; cycles are guarded by a `seen` set (**enforced**) |

---

### 2.19 Judgment

**Executive memory** — what *this* executive concluded, as distinct from what the
organization knows.

| | |
|---|---|
| **Status** | ✅ First-class |
| **Type** | `memory/model.ts › JudgmentMemory` (layer: `executive`) |
| **Owner** | Memory context |
| **Attributes** | `trigger`, `judgment`, `because`, `learnedFrom[]`, `heldBy`, `triggerTags[]`, `timesApplied` |
| **Invariants** | 1. Layer is **always** `executive` (**enforced**: `fabric.add` auto-classifies)<br>2. A Judgment **must** carry its `because` — judgment without a reason is bias (**enforced by type**) |

> This is the seed of **Executive Identity**. Today one executive holds judgments; the
> concept generalises without a schema change.

---

### 2.20 Delegation

Work handed to a named person with bounded authority.

| | |
|---|---|
| **Status** | ✅ First-class — the best-modelled concept in the platform |
| **Type** | `domain/types.ts › Delegation` |
| **Owner** | Services context |
| **Attributes** | `id`, `delegator`, `delegate`, `subject`, `context`, `authorityLevel` (L1–L5), `authorityNote`, `spendCapInr`, `priority`, `deadline`, `status`, `progress`, `createdAt` |
| **Lifecycle** | `Notified → In Progress → At Risk ⇄ Escalated → Completed` (**a guarded state machine**) |
| **Invariants** | 1. Illegal transitions are rejected (**enforced**: `VALID_TRANSITIONS`)<br>2. `Completed` is terminal (**enforced**)<br>3. L3 requires a positive spend cap (**enforced**)<br>4. A delegator cannot delegate authority exceeding their own (**enforced**) |

---

### 2.21 Goal / OKR

| | |
|---|---|
| **Status** | ⬜ **Absent** — zero definitions |
| **Reality** | One seeded `strategic` memory node titled "FY26 objective…". That is a *string*, not a Goal. |

> **DEFECT F7.** EIOS cannot answer "are we on track against our objectives?" — it has no
> Goal entity, no measurement, no linkage from Project → Goal. For a system whose purpose
> is executive alignment, this is a conspicuous hole.

---

### 2.22 Action / Escalation

| | |
|---|---|
| **Status** | ⬜ **Absent** |
| **Reality** | `Escalation` exists only as a `DelegationStatus` string value. `Action` does not exist at all — `recommendedAction` is a string on AttentionItem. |

> **DEFECT F8.** Escalation is a *significant governed organizational act* (who escalated,
> to whom, why, when, what happened). Modelling it as a status enum loses all of that.

---

## 3. Ownership map (which context may write what)

| Concept | Sole writer | Readers |
|---|---|---|
| Organization (TwinState) | **Perception** | Twin, Cognitive, Platform |
| OrgEvent / StoredEvent | **Platform** (append-only) | Perception, Knowledge |
| MemoryNode, Relationship | **Memory fabric** | Knowledge, Cognitive, API |
| Lesson, Wisdom, Confidence, Validity | **Knowledge** | Twin (read-only), API |
| Decision (queue), Delegation, Signal, Incident | **Services** | API, Cognitive |
| Attention, Observation, Prediction | **Twin** | API |
| AuditEvent | **Governance** (append-only) | API |

**Rule:** a context may read across boundaries; it may write only what it owns.
This is currently upheld **by convention, not by the type system** (Finding F9).

---

## 4. Findings — defects this document exposed

Writing the domain model against the code surfaced **nine** defects. None are fixed here;
a freeze exists to establish what is true.

| # | Defect | Severity | Impact |
|---|---|---|---|
| **F1** | **Decision modelled twice, unlinked** (`DecisionItem` ⇎ `DecisionMemory`) | **High** | Today's decisions never become tomorrow's memory. The institutional record is disconnected from live operations — undermining the platform's core premise. |
| **F2** | **Risk is not an entity** | **High** | A bank's Risk Office cannot operate on a `riskScore: number`. No owner, mitigation, or review. |
| **F3** | **"Event" names five different concepts** | Medium | Language failure; the ubiquitous language is not ubiquitous. |
| **F4** | **Policy is not modelled** | **High** | Governance changes require a code deploy. Regulators do not ship on your release train. |
| **F5** | **Recommendation is a bare string** | **High** | Violates Standard S1. AI advice with no provenance, confidence, or alternatives. |
| **F6** | **Commitment is an anonymous type, defined twice, incompatibly** | Medium | The most human-valuable data in the fabric has no id, owner, or due date. |
| **F7** | **Goal/OKR absent** | Medium | Cannot answer "are we on track against objectives?" |
| **F8** | **Escalation is a string enum** | Medium | A governed organizational act reduced to a status value. |
| **F9** | **Context boundaries are conventional, not enforced** | Medium | Nothing stops an Office mutating the Twin except discipline. |

> **These are not a to-do list.** Per the freeze principle, each must be evaluated against:
> *does fixing this make the Deputy Chief's day measurably easier, or does it only make the
> architecture more sophisticated?* On that test, **F1, F4 and F5 pass** (disconnected
> memory, undeployable policy, and unaccountable advice are felt by the executive).
> F3 and F9 are architectural hygiene and should wait.

---

## 5. Change control

This document is **frozen at v1.0**. Any change to a concept's name, invariants, or
ownership is a **breaking change** and requires:

1. An entry in `ARCHITECTURE.md §11` (change log)
2. Justification against the freeze question
3. Update of this document **in the same change** — the model may never lag the code

*Document owner: Chief Platform Engineer · EIOS Domain Model v1.0 · Frozen July 2026*
