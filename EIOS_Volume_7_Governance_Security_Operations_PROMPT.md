# Comprehensive Volume Prompt — EIOS Volume 7: Governance, Security & Operations

> **How to use this prompt**
> Feed this entire document to a capable model as the generation brief for Volume 7 — the final volume. It supersedes the short stub `07_Volume_7_Governance_Security_Operations.md` and reproduces the depth, structure, and house style of the approved Volumes 1–2 and the designs in Volumes 3–6.

---

## 1. Role & Voice

You are a **Principal Security Architect + AI Governance Lead + Enterprise Risk & Compliance Architect + Microsoft Solutions Architect**, authoring for a large **Indian retail bank**. Readers: CISO, CRO, Chief Compliance Officer, Head of Internal Audit, the Model Risk Management function, RBI-facing compliance, the ARB, and SecOps/SRE. Voice: regulated-financial-services governance — rigorous, auditable, defensible. No marketing.

## 2. Deliverable Specification

- **Length:** 40–60 pages of dense structured Markdown.
- **Format:** GitHub-flavored Markdown; `mermaid` for all diagrams; tables for controls, RACI, risk registers, policy catalogs; `[!NOTE]/[!IMPORTANT]/[!WARNING]/[!TIP]` callouts.
- **Document ID:** `EIOS-VOL7-2026-007`. Version 1.0, July 2026, "Internal — Restricted".
- **Predecessors:** Vol 1–6.

### Mandatory document scaffolding (house style)
Title block ("Volume 7 of 7") → **Document Control** table → `[!NOTE] Cross-Reference` box (to Vol 2 decision authority Ch 4 & ADR-003 ₹10L limit, Vol 3 decision engine/learning guardrails, Vol 4 security architecture, Vol 5 rollout) → **Chapter 1 — Executive Summary** (Purpose, Scope in/out table, Key Findings) → domain chapters → **Cross-Volume References** → **Glossary (Volume 7 Additions)** → **Summary** (Key Takeaways + Next Steps table) → footer `*Document ID: EIOS-VOL7-2026-007 | Version 1.0 | Classification: Internal — Restricted*`.

## 3. Core Vision (constant)

EIOS reduces the Deputy Chief's workload ~90%; Microsoft-first, human-in-the-loop, event-driven; one ECC + one "One Prompt". Volume 7 defines the **governance, security, compliance, and operations** that make an autonomous-leaning executive AI **safe and defensible in a regulated Indian bank** — covering RBI expectations, DPDPA, model risk, and the human-in-the-loop guarantees that bound EIOS's autonomy.

## 4. Required Chapters (expand every one)

Each chapter: purpose statement → control model / framework (diagram and/or table) → a banking/UPI worked example → assumptions, trade-offs, alternatives → **≥1 ADR-7xx** where a governance fork exists. Every control must be enforceable and auditable.

1. **Governance Framework & Operating Model** — the EIOS governance structure: the AI governance board, the ARB's role, roles/responsibilities, decision rights, the policy hierarchy, and the accountability model ("EIOS acts; a named human is accountable"). Carries the **Governance Model diagram**.
2. **AI Autonomy Governance** — the guardrails around the Vol 3 decision engine: how Autonomy Tiers are authorized, changed, and reviewed; the **₹10L autonomous financial hard-limit (Vol 2 ADR-003)** enforcement; the "no learning may raise a tier without sign-off" rule (Vol 3); progressive-autonomy gates; and kill-switch/override authority. Autonomy control table.
3. **Human-in-the-Loop & Approval Controls** — the approval architecture: which actions require confirmation, thresholds tied to tier/risk/amount, four-eyes for high-risk, and the delegation-authority controls (Vol 2 Ch 8, L1–L5). Carries the **Approval Flow diagram**.
4. **Security Architecture & Controls** — consolidate and deepen Vol 4 Ch 9: Zero-Trust, identity threat model, secrets/key management, data protection (encryption, CMK/HSM, tokenization), and the control catalog mapped to a recognized framework (e.g., NIST CSF / CIS / Azure Security Benchmark). Carries the **Security Architecture diagram**. Control catalog table.
5. **AI-Specific Threats & Mitigations** — prompt injection, jailbreaks, data exfiltration via the model, training/RAG poisoning, insecure tool use, excessive agency, and hallucination-induced action. Map to OWASP LLM Top 10; mitigation table with owner and control.
6. **Identity & Access — RBAC & ABAC** — the access model: roles, role-permission matrix, attribute-based rules (context, data classification, time), Entra ID/PIM, just-in-time access, and agent/service identities and their least-privilege scopes. RBAC matrix + ABAC policy examples.
7. **Data Privacy & Protection (DPDPA)** — India's Digital Personal Data Protection Act obligations: data inventory/classification, consent and purpose limitation, data-subject rights, minimization, retention, cross-border/localization (RBI storage-in-India), and how EIOS avoids PII leakage into prompts/logs. Privacy controls table.
8. **Regulatory Compliance (RBI & sector)** — RBI expectations relevant to AI in banking ops (IT/cyber/outsourcing directions, IT governance, business-continuity, incident-reporting timelines), NPCI obligations for UPI, and how EIOS produces audit-ready evidence. Regulatory obligation → EIOS control mapping table.
9. **Model Governance & Model Risk Management** — the model lifecycle governance: model inventory, validation/independent review, documentation (model cards), performance & bias monitoring, change control, and the model-risk framework (aligned to sound MRM practice). Ties to Vol 3 evaluation and Vol 5 MLOps.
10. **Auditability & the Decision Journal** — the immutable audit trail: what is logged (every signal, decision, delegation, agent action, override), log integrity (tamper-evidence), retention, and how an auditor reconstructs "why did EIOS do X". Audit-event schema and evidence-package definition.
11. **Operations & Reliability (Runbooks / SRE)** — the operating model to run EIOS in production: SLOs/error budgets, on-call, runbooks, capacity, and the AgentOps observability from Vol 4 Ch 14. Ops responsibilities table.
12. **AI Incident Response** — incident classes unique to EIOS (bad autonomous action, hallucinated decision, prompt-injection event, model degradation, data-leak), detection, containment, the kill-switch, rollback, executive/regulator notification, and post-incident review. Carries an incident-response flow. IR playbook table.
13. **Risk Management** — the consolidated EIOS risk register (security, model, operational, compliance, adoption, third-party) with likelihood/impact/severity, controls, residual risk, and owner; plus a risk severity matrix. Reconcile with Vol 1 Ch 15 and Vol 4/5 risk registers (no contradictions).
14. **Assurance, Testing & Continuous Compliance** — red-teaming cadence, control testing, continuous-compliance automation (evidence auto-collection — Vol 2 AW-16), penetration testing, and the internal-audit interface. Assurance calendar table.
15. **Third-Party & Supply-Chain Governance** — governance of Microsoft/Azure dependency, model providers, and integrators: concentration risk, exit strategy, contractual/SLA controls, and RBI outsourcing-direction alignment.

## 5. Mandatory Diagrams (all mermaid)

- **Security Architecture** (Chapter 4) — Zero-Trust boundaries, identity, data protection, controls.
- **Approval Flow** (Chapter 3) — human-in-the-loop decision/approval routing by tier/risk/amount.
- **Governance Model** (Chapter 1) — governance bodies, roles, decision rights, and escalation.

Add supporting diagrams (incident-response flow, RBAC/ABAC evaluation, model-governance lifecycle) where they aid clarity.

## 6. Banking / UPI Worked Examples

Thread the Vol 2/3 scenario: show governance in action on the **AxisPay SLA penalty (DT-009)** — the approval flow, the four-eyes check, the audit-journal entries, and the evidence package. Show **RBI tokenisation-circular** compliance handling, an **RBI incident-reporting** timeline for a UPI outage, and a **prompt-injection attempt** on One Prompt being contained.

## 7. Controls & ADRs (minimum bar)

≥ 12 tables (control catalog, RBAC matrix, ABAC policies, regulatory mapping, privacy controls, risk register, audit schema, IR playbook). ≥ 6 ADRs (ADR-701…: e.g., how the ₹10L hard-limit is technically enforced; log-integrity mechanism; kill-switch design; CMK vs platform-managed keys; independent model validation model). ≥ 1 consolidated risk register + severity matrix.

## 8. Cross-Volume Consistency

Preserve shared IDs/terminology (AW-xx, DT-xxx, KPI-xxx, agent names, Autonomy Tiers). Enforce, don't contradict, Vol 2 ADR-003 (₹10L) and Vol 3's learning/autonomy guardrails. Reconcile risk registers across Vols 1/4/5/7. Include a **Cross-Volume References** chapter mapping controls back to the capabilities, cognition, platform, build, and UX they govern. As the final volume, include a short **program-wide closing** noting the full 7-volume set is coherent and implementation-ready.

## 9. Writing Standards

Regulated-financial-services governance register; no marketing; every control enforceable and auditable; banking/UPI + RBI/DPDPA examples throughout; assumptions, trade-offs, alternatives, recommendations per chapter; consistent terminology.

## 10. Acceptance Criteria

Acceptable only if: (a) CISO, CRO, Compliance, Audit, and SecOps could adopt it as the governance baseline; (b) all three mandatory diagrams render; (c) RBI, DPDPA, model-risk, and human-in-the-loop guarantees are explicitly and enforceably specified; (d) the ₹10L hard-limit and autonomy guardrails are shown as technically enforced and audited; (e) risk registers reconcile across volumes; and (f) it reproduces the Vol 1/2 scaffolding and footer, and closes out the 7-volume series.
