# EIOS Engineering Standards

**The rules that keep the architecture coherent as it grows.**
Status: **v1.0 — Frozen** · Owner: Chief Platform Engineer · Last reviewed: July 2026

---

## Purpose

A platform this size stops being held together by taste. These are the invariants every
component must uphold, the rationale for each, and — critically — an **honest conformance
audit** against the current codebase.

> **A standard that is not enforced is a wish.** Each standard below carries a real
> status. Where the code violates its own standard, that is stated plainly with the
> defect reference. **10 standards: 6 enforced, 4 violated.** The violations are the
> most valuable content in this document.

**Conformance legend**

| | Meaning |
|---|---|
| ✅ **Enforced** | Code makes violation impossible or fails loudly; verified by test |
| 🟡 **Partial** | Enforced in some paths, not others |
| ❌ **Violated** | The platform does not currently obey its own rule |

---

## The Standards

### S1 — Every recommendation must have provenance

**Rule.** No component may present advice to a human without the evidence it rests on,
traceable to source records.

**Rationale.** An executive who cannot interrogate advice cannot be accountable for
taking it. In a regulated bank, "the AI said so" is not a defensible position at an
inspection.

**Conformance: ❌ VIOLATED** *(Domain Model F5)*

| Path | Status |
|---|---|
| `RecallAnswer.basis[]` — every claim carries `{nodeId, fact, provenance}` | ✅ |
| `Prediction.recommendation` — a bare `string`, no basis | ❌ |
| `DecisionItem.recommendation` — a bare `string`, no basis | ❌ |

The Offices generate the recommendations an executive actually acts on, and those are the
ones with no provenance. `Prediction.precedent[]` is the sole trace and it is optional.

**Verify:** `grep -n "recommendation: string" server/src/twin/model.ts`
**Remedy:** promote Recommendation to an entity with `basis[]`. Passes the freeze test.

---

### S2 — Every decision must have assumptions

**Rule.** A decision record must state the beliefs it rests on.

**Rationale.** Decisions are not wrong when made; they are *overtaken*. Without recorded
assumptions there is no mechanism to notice, and the org relitigates from memory and ego.

**Conformance: 🟡 PARTIAL** *(Domain Model F1)*

| Path | Status |
|---|---|
| `DecisionMemory.assumptions[]` — required by type | ✅ |
| `DecisionItem` — **no assumptions field at all** | ❌ |

Live decisions carry none. Because F1 leaves the two unlinked, approving `DT-007` records
no assumptions anywhere.

**Verify:** `src/__tests__/knowledge.test.ts › "D-193 holds while its assumptions hold"`

---

### S3 — Every assumption must have validity

**Rule.** Validity is **derived** from assumption health, never asserted.

**Rationale.** A stored validity flag is a lie waiting to happen — it drifts the moment
the world moves. Derivation cannot drift.

**Conformance: ✅ ENFORCED**

- `knowledge/lifecycle.ts › validityOf()` computes from assumptions on every read.
- There is **no setter** — validity cannot be written.
- Breaking an assumption *must* name what broke it (`brokenBy`).

**Verify:** `src/__tests__/knowledge.test.ts › "Decision validity is derived from assumptions"` (6 tests)

---

### S4 — Every event must be immutable

**Rule.** Events are appended, never updated or deleted. A correction is a new event.

**Rationale.** Mutable history destroys replay, audit, and time travel simultaneously.
This is the load-bearing standard for the entire Phase 2 platform.

**Conformance: ✅ ENFORCED**

- `platform/eventStore.ts` exposes `append()` only — no update/delete exists.
- Persisted as append-only JSONL; a torn tail truncates rather than corrupting.
- Sequence numbers are monotonic; ordering is the truth.

**Verify:** `src/__tests__/platform.test.ts › "is append-only"`, `"SURVIVES RESTART"`

---

### S5 — Every policy decision must be auditable

**Rule.** Any governance outcome — allow, deny, escalate — must land in the immutable
journal with actor, resource, and reason.

**Rationale.** An auditor must reconstruct *why* the system permitted or refused an action
without reading source code.

**Conformance: 🟡 PARTIAL** *(Domain Model F4)*

| Path | Status |
|---|---|
| Guardrail blocks → `guardrail.blocked` journalled with reason | ✅ |
| Decision resolutions → `decision.resolved` journalled | ✅ |
| Audit chain is tamper-evident (SHA-256, verifiable) | ✅ |
| **RBAC 403 denials at routes → not journalled** | ❌ |

An auditor can see what EIOS *blocked autonomously*, but not who was *refused access*.
Compounded by F4: policy is hardcoded, so the policy that produced a decision cannot be
versioned or cited.

**Verify:** `src/__tests__/audit.test.ts`; `GET /api/audit`

---

### S6 — Every AI output must expose confidence dimensions

**Rule.** No scalar confidence. Any AI-derived output must expose evidence, reasoning,
policy, freshness, and human-validation state — plus what limits the overall score.

**Rationale.** `0.92` is unactionable. *"62%, limited by freshness — the estimate is 4
months old"* tells the executive what to fix. Scalars also let one strong dimension mask a
fatal one.

**Conformance: ❌ VIOLATED**

| Path | Status |
|---|---|
| `MemoryNode.confidence` — full 5-dimension + `limitedBy` + `explanation` | ✅ |
| `RecallAnswer.confidenceDetail` | ✅ |
| **`DecisionItem.confidence: number`** — a bare scalar, and it gates autonomous execution | ❌ |

The most consequential confidence value in the platform — the one the ₹10L guardrail reads
— is the one that is a naked float.

**Verify:** `grep -n "confidence: number" server/src/domain/types.ts`

---

### S7 — Every autonomous action must be replayable

**Rule.** Any action EIOS takes without a human must be reconstructible from the event log.

**Rationale.** "Why did it do that?" must be answerable months later, from the log alone.
This is the difference between an auditable system and a defensible shrug.

**Conformance: ❌ VIOLATED**

| Path | Status |
|---|---|
| Twin state — fully replayable, determinism verified at boot | ✅ |
| **Decisions, delegations, signals — never enter the event log** | ❌ |
| **Attention items — computed per beat, never persisted** | ❌ |

The *organization* replays. EIOS's own *actions* do not. An auto-executed decision leaves
an audit entry but cannot be replayed into the state that produced it. This is the
sharpest architectural inconsistency in the platform.

**Verify:** `GET /api/platform/determinism` (twin only); no equivalent exists for actions.

---

### S8 — Every knowledge mutation must be attributable

**Rule.** No record may enter or change in the fabric without provenance: source, who
recorded it, and epistemic status (`stated` / `derived` / `inferred`).

**Rationale.** Unattributed knowledge is rumour. The `stated`/`derived`/`inferred`
distinction is what stops a model's guess being read as a CEO's quote.

**Conformance: ✅ ENFORCED**

- `fabric.add()` normalizes and **refuses bare records** — a node without provenance,
  layer, lifecycle and confidence cannot be stored.
- Confidence is computed **from** provenance (`derived` ⇒ never `validated`).
- Every `MemoryRelation` also requires provenance by type.

**Verify:** `src/__tests__/knowledge.test.ts › "The fabric stores knowledge, not records"`

---

### S9 — No component may fabricate organizational state

**Rule.** If EIOS does not observe something, it must not invent it. Unconfigured
integrations return nothing; unknown entities are rejected.

**Rationale.** The single worst failure mode for an executive platform: confident,
plausible, fictional organizational state. Once an executive catches EIOS inventing one
number, the whole platform is dead.

**Conformance: ✅ ENFORCED**

- Enterprise connectors (`MsGraph`, `AzureDevOps`, `ServiceNow`, `AzureMonitor`) return
  `[]` without credentials and report `not-configured`.
- The reducer **rejects** events for unknown entities rather than creating them.
- The synthetic connector is labelled `synthetic` everywhere, and its evidence is scored
  lower (0.5) than a real system's (0.9).
- The UI states `liveSources: 0` — *"the twin is observing a simulation, not your
  organization."*

**Verify:** `src/__tests__/perception.test.ts › "enterprise connectors ... emit NOTHING without credentials"`

---

### S10 — Unknown is preferable to guessed

**Rule.** When the platform cannot know, it must say so — never estimate to look complete.

**Rationale.** In banking, a confident wrong answer costs more than an admitted gap. This
is the standard that earns the right to be trusted on the answers EIOS *does* give.

**Conformance: ✅ ENFORCED** — the best-upheld standard in the platform.

- Recall: *"Memory has no record of that. I won't guess"* + explicit `gaps[]`.
- Recall volunteers unverified assumptions as gaps, unprompted.
- Scorecard: 5/8 metrics report `measurable: false` **with the reason**, rather than a
  flattering default.
- **Missed critical event rate** is declared *not self-measurable by design* — a missed
  event is one EIOS never saw.
- Rates refuse to compute below n=3 — *"a rate over two data points is noise wearing a
  percentage sign."*
- Redactions are **reported** (`🔒 1 redacted`), never silently dropped.
- Knowledge quality reports **77/100**, not a vanity 100.

**Verify:** `src/__tests__/platform.test.ts › "Architecture scorecard"` (6 tests);
`src/__tests__/memory.test.ts › "Memory honesty"`

---

## Additional standards (adopted at v1.0)

### S11 — A context may write only what it owns
Cross-context reads are permitted; writes are not. See `DOMAIN_MODEL.md §3`.
**Conformance: 🟡 by convention only** *(F9)* — nothing in the type system prevents an
Office mutating the Twin.

### S12 — Derived state is never stored
Validity, confidence overall, attention scores, office health, and the state hash are all
computed on read. **Conformance: ✅ Enforced.**

### S13 — Governance is enforced in the domain, not the UI
Every rule must hold when the UI is bypassed. **Conformance: ✅ Enforced** — RBAC/ABAC and
the ₹10L limit are enforced server-side; the One-Prompt surface runs the *same* checks, so
the conversational path cannot exceed the executive's authority.

### S14 — Time is explicit and typed
Distinguish *when it happened* (`at`) from *when it was recorded* (`recordedAt`) from
*when it was last verified* (`lastVerifiedAt`). **Conformance: ✅ Enforced.**

### S15 — The system proposes; a human disposes
No AI inference may become organizational policy without named human approval.
**Conformance: ✅ Enforced** — `WisdomEngine.approve` is the only path from candidate to
active Lesson, requires `decision:approve`, and records the approver.

---

### S16 - Personal and restricted knowledge never enters an LLM prompt
The executive may read all of his own memory. A prompt leaving this machine may not carry
`personal` or `restricted` records, however useful they would be.
**Rationale.** A local read cannot leak; an LLM call crosses a network and a company
boundary. DPDPA does not care how good the answer would have been.
**Conformance: ENFORCED** - `LLM_ACCESS` is applied at context assembly
(`cognitive/reasoner.ts`), not left to the model's discretion. PII is additionally
regex-redacted (`llm/redact.ts`). Withheld records are **reported**, not hidden.
**Verify:** `src/__tests__/memory.test.ts > "LLM egress governance (DPDPA)"` (7 tests)

## Conformance summary

| Standard | Status |
|---|---|
| S1 Recommendation provenance | ❌ Violated |
| S2 Decisions have assumptions | 🟡 Partial |
| S3 Assumptions have validity | ✅ |
| S4 Events immutable | ✅ |
| S5 Policy decisions auditable | 🟡 Partial |
| S6 Confidence dimensions | ❌ Violated |
| S7 Autonomous actions replayable | ❌ Violated |
| S8 Knowledge attributable | ✅ |
| S9 No fabricated state | ✅ |
| S10 Unknown over guessed | ✅ |
| S11 Context ownership | 🟡 Convention |
| S12 Derived state not stored | ✅ |
| S13 Governance in domain | ✅ |
| S14 Explicit time | ✅ |
| S15 System proposes, human disposes | ✅ |
| S16 No personal data in LLM prompts | ✅ |

**11 of 16 enforced · 3 partial · 3 violated.** (S16 added by ADR-010; RBAC removed - one user.)

### What the violations have in common

S1, S6 and S7 all fail **in the same place**: the operational path (`DecisionItem`,
`Prediction`, `AttentionItem`) — the newest code, written before the knowledge layer
raised the bar. The *knowledge* layer obeys every standard; the *operational* layer
predates them.

That is a coherent, fixable story rather than scattered rot: the operational domain needs
to be brought up to the standard the knowledge domain already meets. It is one workstream,
and it maps exactly to Domain Model defects **F1 / F5**.

---

## Enforcement

Standards are currently upheld by **review and tests**, not by tooling. Before this list
can be relied on at scale it needs:

- lint rules for the mechanical ones (S12, S14),
- an architecture-fitness test for context ownership (S11),
- a CI gate that fails on a new `confidence: number` or `recommendation: string` (S1, S6).

Until then, this document is the contract, and the conformance table is its audit.

*Document owner: Chief Platform Engineer · EIOS Engineering Standards v1.0 · Frozen July 2026*
