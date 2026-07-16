# Comprehensive Volume Prompt — EIOS Volume 4: Enterprise Technical Architecture

> **How to use this prompt**
> Feed this entire document to a capable model as the generation brief for Volume 4. It supersedes the short stub `04_Volume_4_Enterprise_Technical_Architecture.md` and is written to reproduce the depth, structure, and house style of the approved Volumes 1–2 and the cognitive design in Volume 3.

---

## 1. Role & Voice

You are a **Principal Enterprise AI Architect + Microsoft Solutions Architect + Enterprise Architect**, authoring for a large **Indian retail bank's Digital & Technology division**. Readers: CTO, CIO, Head of Cloud/Infrastructure, Head of Security Architecture, the Enterprise Architecture Council, the ARB, and the platform/SRE teams. Voice: Microsoft-internal architecture-strategy — precise, buildable, no marketing.

## 2. Deliverable Specification

- **Length:** 60–80 pages of dense structured Markdown.
- **Format:** GitHub-flavored Markdown; `mermaid` for all diagrams; Markdown tables for all matrices; `[!NOTE]/[!IMPORTANT]/[!WARNING]/[!TIP]` callouts.
- **Document ID:** `EIOS-VOL4-2026-004`. Version 1.0, July 2026, "Internal — Restricted".
- **Predecessors:** Vol 1–3.

### Mandatory document scaffolding (same house style as Vol 1–2)
Title block ("Volume 4 of 7") → **Document Control** table → `[!NOTE] Cross-Reference` box (to Vol 2 value streams Ch 13, Vol 3 memory/agents, Vol 1 Microsoft-first Ch 14) → **Chapter 1 — Executive Summary** (1.1 Purpose, 1.2 Scope in/out table, 1.3 Key Findings finding→implication table) → domain chapters → **Cross-Volume References** chapter → **Glossary (Volume 4 Additions)** → **Summary** (Key Takeaways + Next Steps table) → footer `*Document ID: EIOS-VOL4-2026-004 | Version 1.0 | Classification: Internal — Restricted*`.

## 3. Core Vision (constant)

EIOS reduces the Deputy Chief's workload ~90%; **Microsoft-first, human-in-the-loop, event-driven**; one ECC + one "One Prompt" interface. Volume 4 defines the **enterprise technical architecture** that runs the cognitive system of Vol 3 and delivers the business capabilities of Vol 2 — on Azure, integrated with Microsoft 365, and compliant with Indian banking regulation (RBI, data localization, DPDPA).

## 4. Required Chapters (expand every one)

For each chapter: purpose statement → reference architecture (diagram and/or table) → concrete Azure service choices with SKUs/tiers where meaningful → a banking/UPI worked example → assumptions, trade-offs, alternatives → **≥1 ADR-4xx**. Prefer specific, named Azure services over generic descriptions.

1. **Architecture Overview & Principles** — logical layers (experience → orchestration → cognition → integration → data → platform), quality attributes (latency, availability, scalability, security, cost, sovereignty), and the tenets carried from Vol 1. Carries the **End-to-End Architecture diagram**.
2. **Microsoft Ecosystem & Landing Zone** — Azure landing zone design (management groups, subscriptions, RG topology), Entra ID, Azure Policy, and why Microsoft-first (Vol 1 Ch 14). RBI/sovereign-cloud considerations for an Indian bank (Central India / South India regions, data residency).
3. **Compute & Application Architecture** — hosting choices (Azure Container Apps / AKS / Functions), the API/service decomposition, the agent-runtime hosting, and the orchestration tier that runs Vol 3's multi-agent system. Include a component decomposition table.
4. **Microsoft 365 & Copilot Integration** — Graph API, Teams (bot + adaptive cards for One Prompt), Outlook/Exchange (email triage AW-01), Power Platform (ECC surfaces), Copilot/agent extensibility, and Graph permission scopes. Least-privilege scope table.
5. **AI Platform Integration** — Azure OpenAI / Azure AI Foundry, Azure AI Search (RAG), content safety, model deployment topology, throughput (PTUs vs. pay-as-you-go), and private networking to AI endpoints. Implements Vol 3's model strategy.
6. **Data Platform** — the data architecture: ingestion (Fabric/Synapse/Event streams), lakehouse/medallion layout, the operational stores (Cosmos DB for state, Azure AI Search for vectors, Azure SQL where relational), the knowledge-graph store (Vol 3 Ch 12), and MDM. Carries the **Data Flow diagram**.
7. **Event-Driven Architecture** — the event backbone (Event Grid / Event Hubs / Service Bus), event taxonomy, idempotency, ordering, dead-lettering, and how Vol 2 atomic workflows (AW-xx) are triggered. Event catalog table.
8. **Integration & API Architecture** — API gateway (Azure API Management), connectors to source systems (ServiceNow, Azure DevOps, Finacle/core banking, NPCI, vendor SLA feeds), integration patterns (sync/async/webhook), API versioning and contracts. Source-system integration matrix. Carries a **Sequence diagram** (e.g., UPI incident signal → agent action).
9. **Security Architecture** — identity (Entra ID, managed identities, PIM), secrets (Key Vault/HSM), data protection (encryption at rest/in transit, CMK), network security, Zero-Trust segmentation, and the security boundary model. Carries the **Network diagram**. (Deep governance/RBAC lives in Vol 7 — reference, don't duplicate.)
10. **Networking** — VNet topology, private endpoints, hub-spoke, egress control, DNS, connectivity to on-prem core banking, and DDoS/WAF at the edge.
11. **Storage & Data Lifecycle** — storage tiers, retention, archival, data classification, and residency/localization enforcement (RBI storage-in-India mandate).
12. **Scalability & Performance** — scaling strategy per tier, capacity model tied to Vol 2 volumes (e.g., 300 emails/day, continuous UPI monitoring), caching, load/latency budgets, and cost-performance trade-offs.
13. **High Availability & Disaster Recovery** — availability zones, multi-region strategy, RTO/RPO targets per component, backup, failover runbooks, and DR testing cadence. HA/DR objectives table.
14. **Observability** — logging, metrics, tracing (Azure Monitor, App Insights, Log Analytics), AgentOps/LLM observability (token, latency, groundedness telemetry), dashboards, and alerting. Ties to Vol 2 KPI telemetry sources.
15. **Deployment & Environments** — environment topology (dev/test/staging/prod), IaC (Bicep/Terraform), and the deployment model. Carries the **Deployment diagram**. (Full CI/CD pipeline design belongs to Vol 5 — reference it.)
16. **Cost Architecture (FinOps)** — cost model aligned to the Vol 2 operating-model canvas (~₹3Cr/yr Azure, ~₹1Cr/yr M365), tagging, budgets/alerts, PTU vs PAYG economics, and optimization levers.

## 5. Mandatory Diagrams (all mermaid)

- **End-to-End Architecture** (Chapter 1) — all logical layers and their Azure services.
- **Deployment** (Chapter 15) — environments, regions, and resource topology.
- **Data Flow** (Chapter 6) — from source systems through ingestion, cognition, to ECC/One Prompt.
- **Sequence** (Chapter 8) — a concrete end-to-end flow, e.g., UPI degradation signal → perception → agent → delegation → ECC update.
- **Network** (Chapter 9) — VNet/hub-spoke, private endpoints, on-prem connectivity.

## 6. Banking / UPI Worked Examples

Thread the Vol 2/3 scenario: show the **AxisPay UPI degradation** flowing across the event backbone, being enriched from the data platform and knowledge graph, actioned by an agent, and surfaced in the ECC — with the exact Azure services on the path. Include an **RBI data-localization** example and an **NPCI integration** example.

## 7. Tables & ADRs (minimum bar)

≥ 12 tables (service selection, integration matrix, event catalog, HA/DR objectives, permission scopes, cost model). ≥ 8 ADRs (ADR-401…: e.g., AKS vs Container Apps; PTU vs PAYG; single- vs multi-region; Cosmos vs SQL for state; sync vs async integration to core banking). ≥ 1 technical risk register.

## 8. Cross-Volume Consistency

Keep all shared IDs/terminology (AW-xx, DT-xxx, KPI-xxx, agent names, Autonomy Tiers). Every Vol 3 cognitive component must have a hosting/runtime home here. Include a **Cross-Volume References** chapter linking to Vol 2 (capabilities/value streams), Vol 3 (cognition), Vol 5 (engineering/CI-CD), Vol 7 (security/governance depth). Flag what Vol 5 and Vol 7 must implement.

## 9. Writing Standards

Internal Microsoft architecture-strategy tone; no marketing; every recommendation implementable; banking/UPI examples throughout; assumptions, trade-offs, alternatives, and recommendations per chapter; consistent terminology.

## 10. Acceptance Criteria

Acceptable only if: (a) platform/cloud/security/SRE teams can build and deploy from it; (b) all five mandatory diagrams render; (c) every service choice is specific and justified with an alternative considered; (d) RBI localization, DPDPA, and sovereignty constraints are explicitly addressed; (e) it hosts every Vol 3 cognitive component and triggers every Vol 2 workflow; and (f) it reproduces the Vol 1/2 scaffolding and footer.
