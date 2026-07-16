# Comprehensive Volume Prompt — EIOS Volume 6: UX, Dashboards & Interaction

> **How to use this prompt**
> Feed this entire document to a capable model as the generation brief for Volume 6. It supersedes the short stub `06_Volume_6_UX_Dashboard_Interaction.md` and reproduces the depth, structure, and house style of the approved Volumes 1–2 and the designs in Volumes 3–5.

---

## 1. Role & Voice

You are a **Principal Product Designer / UX Architect + Enterprise AI Architect + Product Strategist**, authoring for a large **Indian retail bank**. Readers: Head of Design, Product Managers, front-end/Power Platform engineers, accessibility leads, and executive leadership (the Deputy Chief is the primary user). Voice: design-strategy meets implementation spec — opinionated, buildable, evidence-led. No marketing.

> Continuity note: a working front-end prototype already exists (`eios-prototype/`) implementing the Executive Command Center and the "One Prompt" panel. Treat it as the reference implementation to formalize, critique, and extend — not to ignore.

## 2. Deliverable Specification

- **Length:** 30–40 pages of dense structured Markdown.
- **Format:** GitHub-flavored Markdown; `mermaid` for wireframes/flows/navigation; tables for design-system tokens, widget catalogs, and journey maps; `[!NOTE]/[!IMPORTANT]/[!WARNING]/[!TIP]` callouts. Use ASCII/mermaid wireframes (no external images).
- **Document ID:** `EIOS-VOL6-2026-006`. Version 1.0, July 2026, "Internal — Restricted".
- **Predecessors:** Vol 1–5.

### Mandatory document scaffolding (house style)
Title block ("Volume 6 of 7") → **Document Control** table → `[!NOTE] Cross-Reference` box (to Vol 1 personas Ch 5 & one-prompt Ch 13, Vol 2 stakeholder analysis Ch 5, Vol 5 experience squad) → **Chapter 1 — Executive Summary** (Purpose, Scope in/out table, Key Findings) → domain chapters → **Cross-Volume References** → **Glossary (Volume 6 Additions)** → **Summary** (Key Takeaways + Next Steps table) → footer `*Document ID: EIOS-VOL6-2026-006 | Version 1.0 | Classification: Internal — Restricted*`.

## 3. Core Vision (constant)

EIOS reduces the Deputy Chief's workload ~90%; Microsoft-first, human-in-the-loop, event-driven; centered on **one Executive Command Center (ECC)** and **one conversational command interface ("One Prompt")**. Volume 6 defines the **experience layer**: how the executive sees, understands, and commands EIOS with minimum cognitive load — surfaced primarily in **Microsoft Teams + Power Platform**, with a mobile companion.

## 4. Required Chapters (expand every one)

Each chapter: purpose statement → wireframe/flow (mermaid or ASCII) and/or spec table → a banking/UPI worked example → assumptions, trade-offs, alternatives → **≥1 ADR-6xx** where a design fork exists.

1. **Experience Principles & Mission Control Concept** — the design philosophy: glanceability, exception-first, progressive disclosure, trust/explainability, one-surface-to-command. Define "Mission Control" and the reduce-cognitive-load mandate from Vol 1 Ch 7.
2. **Personas & Design Targets** — reuse Vol 1 personas (Deputy Chief primary; Chief of Staff, VPs secondary) and Vol 2 stakeholders; for each, their context of use (times of day, devices, information needs) and design implications. Persona-to-surface table.
3. **Information Architecture & Navigation** — the ECC IA, the surface map (Teams app, ECC dashboard, Power BI analytics, mobile), and how "One Prompt" is always reachable. Carries the **Navigation diagram**.
4. **Executive Command Center Dashboard** — the flagship screen: layout, the widget grid, priority queue, KPI strip, channel health, decision queue, incidents, delegation tracker. Provide **dashboard wireframes** (mermaid/ASCII), responsive behavior, and empty/loading/error states. Map every widget to its Vol 2 data source and Vol 3 agent.
5. **One Prompt UI** — the conversational command surface: input affordances, suggestion chips, streaming responses, citations/grounding display, confirmation dialogs for human-in-the-loop actions, and the "recommend vs act" distinction. Carries the **Interaction Flow diagram** (e.g., "delegate the UPI issue" → confirm → tracked).
6. **Dashboard Widget Catalog** — a catalog of reusable widgets (metric tile, health bar, signal card, decision row, delegation card, incident item, briefing card, trend spark). For each: purpose, data contract, states, interaction, and accessibility notes. Widget spec table.
7. **Interaction Patterns** — canonical patterns: triage-and-clear, approve/reject/modify/defer (from Vol 2 decision workflow), delegate-and-track, drill-down, undo/reversibility, and confirmation thresholds tied to Autonomy Tiers. Pattern table.
8. **Notifications & Alerting** — the notification model: channels (Teams push, ECC badge, email digest, mobile), severity-to-channel routing, quiet hours, escalation, and anti-alert-fatigue rules (only anomalies surface — Vol 2). Notification routing matrix.
9. **Design System** — tokens (color incl. status semantics, typography, spacing, elevation, motion), theming (light/dark), Fluent/Fluent 2 alignment, component inventory, and the banking-appropriate visual tone. Token tables. Note where the existing prototype's CSS realizes these tokens.
10. **Accessibility** — WCAG 2.2 AA targets, keyboard navigation, screen-reader semantics, color-contrast for status colors, reduced-motion, and executive-specific needs. Accessibility conformance checklist.
11. **Mobile & On-the-Go** — the mobile companion scope (glance, approve, delegate, get briefed), constraints, offline/degraded behavior, and secure-device considerations for a banking executive.
12. **Journey Maps** — end-to-end experience journeys mapping to Vol 1 Ch 12 "day in the life": the 06:30 morning briefing journey, the UPI-incident triage journey, and the vendor-renewal decision journey — each with steps, emotions, surfaces, and EIOS actions. Carries at least one **journey map** (table or mermaid).
13. **Content & Conversation Design** — voice/tone for EIOS's messages, microcopy standards, how recommendations and uncertainty are phrased, error/empty-state copy, and localization/English-India considerations.
14. **Usability, Metrics & Validation** — how UX success is measured (task time, glance-to-decision time, trust/confidence, adoption) mapped to Vol 2 KPIs (workload, decision velocity, meeting reduction), plus the usability-testing plan with the executive.

## 5. Mandatory Diagrams (mermaid or ASCII wireframes)

- **Dashboard Wireframes** (Chapter 4) — the ECC layout and key widget arrangement.
- **Navigation** (Chapter 3) — surface/navigation map across Teams, ECC, analytics, mobile.
- **Interaction Flow** (Chapter 5) — a concrete One-Prompt human-in-the-loop flow.

Add supporting wireframes (One Prompt panel, mobile screens, notification examples) freely.

## 6. Banking / UPI Worked Examples

Thread the Vol 2/3 scenario through the UX: the morning briefing card summarizing the **AxisPay UPI dip**, the **decision-queue** rows for the **CDN renewal** and **SLA penalty**, the **delegation card** for INC-4521, and the One-Prompt flow "delegate the UPI issue → confirm". Keep terminology and data identical to the prototype and Vol 2.

## 7. Specs & ADRs (minimum bar)

≥ 10 spec tables (widget catalog, design tokens, notification routing, accessibility checklist, journey maps). ≥ 5 ADRs (ADR-601…: e.g., Teams-embedded vs standalone web app; Power Apps vs custom React for ECC; conversation-first vs dashboard-first default surface; light/dark default; mobile-native vs PWA). ≥ 1 UX risk register (trust in AI output, over-reliance, alert fatigue, accessibility gaps).

## 8. Cross-Volume Consistency

Preserve shared IDs/terminology (AW-xx, DT-xxx, KPI-xxx, agent names, Autonomy Tiers) and align every widget to a Vol 2 data source + Vol 3 agent + Vol 4 API. Reconcile with the existing `eios-prototype/` (call out where the spec extends or diverges from it). Include a **Cross-Volume References** chapter and flag what Vol 5 (experience squad) builds and what Vol 7 (governance) constrains (e.g., what actions require explicit confirmation).

## 9. Writing Standards

Design-strategy-plus-spec register; no marketing; every recommendation implementable by front-end/Power Platform engineers; banking/UPI examples throughout; assumptions, trade-offs, alternatives, recommendations per chapter; consistent terminology.

## 10. Acceptance Criteria

Acceptable only if: (a) designers and front-end engineers can build the ECC and One-Prompt experiences from it; (b) all three mandatory diagrams/wireframes render; (c) every widget maps to a data source, agent, and API; (d) WCAG 2.2 AA and human-in-the-loop confirmation patterns are specified; (e) it reconciles explicitly with the existing prototype; and (f) it reproduces the Vol 1/2 scaffolding and footer.
