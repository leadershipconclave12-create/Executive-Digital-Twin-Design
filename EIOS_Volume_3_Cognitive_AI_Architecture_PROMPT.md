# Comprehensive Volume Prompt — EIOS Volume 3: Cognitive & AI Architecture

> **How to use this prompt**
> Feed this entire document to a capable model as the generation brief for Volume 3. It supersedes the short stub `03_Volume_3_Cognitive_AI_Architecture.md`. It is written to reproduce the depth, structure, and house style of the already-approved Volume 1 (`EIOS_Volume_1_Product_Vision.md`) and Volume 2 (`EIOS_Volume_2_Business_Architecture.md`).

---

## 1. Role & Voice

You are simultaneously a **Principal Enterprise AI Architect, Product Strategist, Enterprise Architect, Microsoft Solutions Architect, and Executive Leadership Consultant**. Write as the authoring **Principal Enterprise AI Architecture Team** producing an internal, consulting-grade architecture document for a large **Indian retail bank's Digital & Technology division**. The reader set is technical and senior: CTO, CIO, Chief AI Officer, Enterprise Architecture Council, the Architecture Review Board (ARB), and the AI/ML platform team.

Voice: precise, evidence-led, Microsoft-internal-strategy tone. **No marketing language.** Every claim is implementable and traceable to a business capability, workflow, or decision defined in Volumes 1–2.

## 2. Deliverable Specification

- **Length:** 50–70 pages of dense, structured Markdown.
- **Format:** GitHub-flavored Markdown. Use `mermaid` fenced code blocks for every diagram, Markdown tables for every matrix, and `> [!NOTE] / [!IMPORTANT] / [!WARNING] / [!TIP]` callouts.
- **Document ID:** `EIOS-VOL3-2026-003`. Version 1.0, Date July 2026, Classification "Internal — Restricted".
- **Predecessors to cite:** Vol 1 (`EIOS-VOL1-2026-001`), Vol 2 (`EIOS-VOL2-2026-002`).
- **Numbering:** `# Chapter N — Title`, `## N.x`, `### N.x.y`. Number every table and figure implicitly by section.

### Mandatory document scaffolding (reproduce in this order)
1. Title block: volume name, "Volume 3 of 7", classification, version, date, author, status ("Draft for ARB Review"), distribution list.
2. **Document Control** table (Document ID, Version, Last Updated, Review Cycle, Classification, Predecessor, Related Volumes).
3. A `> [!NOTE] Cross-Reference` box pointing to the specific Vol 1/2 sections this volume builds on (automation opportunities Vol 2 Ch 11, decision taxonomy Vol 2 Ch 6, capability map Vol 1 Ch 11, one-prompt philosophy Vol 1 Ch 13).
4. `# Chapter 1 — Executive Summary` containing **1.1 Purpose**, **1.2 Scope** (In-Scope / Out-of-Scope two-column table), **1.3 Key Findings** (finding → implication table).
5. The domain chapters (Section 4 below).
6. `# Chapter — Cross-Volume References` (table mapping each chapter to the Vol it depends on / feeds).
7. `# Chapter — Glossary (Volume 3 Additions)`.
8. `# Chapter — Summary` with **Key Takeaways** (numbered) and **Next Steps** (owner/timeline/dependency table).
9. Footer line: `*Document ID: EIOS-VOL3-2026-003 | Version 1.0 | Classification: Internal — Restricted*`.

## 3. Core Vision (hold constant across all volumes)

EIOS is an **Executive Intelligence Operating System** that reduces the Deputy Chief (Operations)'s operational workload by ~90%. It is **Microsoft-first, human-in-the-loop, event-driven**, and centered on **one Executive Command Center (ECC)** and **one conversational command interface ("One Prompt")**. Volume 3 defines the **cognitive architecture** — how EIOS perceives, understands, remembers, reasons, plans, decides, learns, and coordinates its agent workforce.

## 4. Required Chapters (expand every one — this is the core of the deliverable)

For **each** chapter: open with a 2–4 sentence purpose statement, give the conceptual model, provide at least one mermaid diagram OR one detailed table (most chapters need both), include a **worked banking/UPI example**, state **assumptions, trade-offs, and alternatives considered**, and close with **≥1 numbered Architecture Decision Record (ADR-3xx)** where a real design fork exists.

1. **The Cognitive Architecture Overview ("The AI Brain")** — a single unifying model of the eight cognitive faculties (Perception → Understanding → Context → Memory → Reasoning → Planning → Simulation → Decision), the sense-think-act loop, and how learning + governance wrap around it. This chapter carries the **AI Brain diagram**.
2. **Perception** — signal ingestion and normalization: email, Teams, ServiceNow, Azure Monitor, NPCI feeds. Multi-modal parsing, entity/intent extraction, signal typing that feeds Vol 2's Signal Triage workflow. Latency budget per signal class.
3. **Understanding** — NLU, intent classification, semantic enrichment, disambiguation. Map intents to the Vol 2 decision taxonomy and atomic workflows (AW-01…AW-20).
4. **Context** — context assembly: identity/role context, temporal context, situational context (active incidents, org calendar), and the retrieval strategy (RAG over the knowledge graph + document stores). Define the **context window budget** and freshness rules.
5. **Memory** — the tiered memory architecture: working/short-term, episodic (decision journal), semantic (institutional knowledge), procedural (playbooks). Storage mapping to Azure (Cosmos DB, Azure AI Search, blob). This chapter carries the **Memory Architecture diagram**.
6. **Reasoning** — reasoning strategies (chain-of-thought, ReAct, tree-of-thought, tool-use), confidence scoring, uncertainty handling, and grounding/citation requirements. This chapter carries the **Reasoning Pipeline diagram**.
7. **Planning** — task decomposition, plan generation, HTN/goal-oriented planning, plan validation against guardrails, and re-planning on failure.
8. **Simulation** — "what-if" pre-execution modeling: impact analysis before acting (e.g., simulate an SLA-penalty action's contractual and relationship effects) and counterfactual reasoning for decision support.
9. **Decision Engine** — operationalize the Vol 2 Ch 6 decision taxonomy: how a decision is classified into Tier 1 (Autonomous) / Tier 2 (Supervised) / Tier 3 (Human-Required), the confidence × risk gating matrix, the ₹10L autonomous financial hard-limit (ADR-003 from Vol 2), override handling, and full decision logging.
10. **Learning** — feedback loops from overrides and outcomes, preference learning, RLHF-style tuning boundaries, knowledge-graph enrichment, and the guardrail that **no learning may raise an autonomy tier without human sign-off**.
11. **Agent Departments** — the multi-agent workforce. Define each agent named in Vol 2 (Intelligence, Operations, Coordination, Analytics, Compliance, Delivery): its charter, tools, memory scope, autonomy ceiling, and the Vol 2 workflows it owns. Include an agent capability/RACI-style table.
12. **Knowledge Graph** — ontology (entities: incidents, vendors, decisions, delegations, systems, regulations, people; relationships), ingestion, versioning, and query patterns. This chapter carries the **Knowledge Graph diagram**.
13. **Multi-Agent Orchestration** — orchestration patterns (supervisor/router, sequential, parallel, blackboard), inter-agent messaging, conflict resolution, shared state, and human-in-the-loop interrupt points. This chapter carries the **Agent Interaction diagram**.
14. **Prompt Architecture** — the layered prompt system behind "One Prompt": system/role prompts, guardrail prompts, tool schemas, context injection, output contracts (JSON), prompt versioning and testing. Connect to Vol 1 Ch 13 one-prompt decomposition.
15. **Evaluation & Assurance** — how cognition is measured: golden datasets, offline eval harness, groundedness/faithfulness/hallucination metrics, decision-quality metrics, red-teaming, and the online guardrail monitors. Tie metrics to Vol 2 KPIs (Decision Override Rate KPI-006, Missed Critical Signal Rate KPI-008, Agent Success Rate KPI-011).
16. **Model Strategy** — model selection and routing across the Azure OpenAI / Microsoft model estate (frontier vs. small models, cost-latency tiers, fallback chains, fine-tuning vs. RAG decision, on-prem/sovereignty considerations for a regulated Indian bank). Include a model-to-task routing table.

## 5. Mandatory Diagrams (all as mermaid; these are non-negotiable)

- **AI Brain** — the eight faculties + learning + governance loop (Chapter 1).
- **Reasoning Pipeline** — signal → context → reasoning → decision → action (Chapter 6).
- **Memory Architecture** — the four memory tiers and their Azure backing stores (Chapter 5).
- **Agent Interaction** — supervisor orchestrating the six agent departments with HITL interrupts (Chapter 13).
- **Knowledge Graph** — core ontology and relationships (Chapter 12).

Add supporting mermaid diagrams freely where they clarify (decision-gating flow, prompt-layering stack, eval pipeline).

## 6. Banking / UPI Worked Examples (thread these through)

Reuse the Vol 2 scenario for continuity: the **AxisPay PSP UPI degradation (INC-4521)**, the **RBI tokenisation circular (RBI/2026-27/44)**, the **Akamai CDN ₹1.2Cr renewal**, and the **AxisPay SLA-breach penalty (DT-009)**. Show how each traverses the cognitive stack — e.g., perception of the UPI success-rate dip, context assembly (PSP history, SLA state, customer impact), reasoning to a Tier-2 recommendation, simulation of the penalty's downstream effect, and knowledge-graph capture of the outcome.

## 7. Tables & ADRs (minimum bar)

- ≥ 12 substantive tables (taxonomies, capability matrices, model routing, metric definitions, agent charters).
- ≥ 6 ADRs (ADR-301…), each: Context / Decision / Alternatives Considered / Consequences.
- ≥ 1 risk register table specific to cognitive risks (hallucination, prompt injection, model drift, over-automation).

## 8. Cross-Volume Consistency Rules

- Keep terminology identical to Vols 1–2 (Autonomy Tiers, Atomic Workflow IDs AW-xx, Decision IDs DT-xxx, KPI IDs KPI-xxx, agent names).
- Every automation opportunity in Vol 2 Ch 11 must map to a named agent + cognitive faculty here.
- Include a **Cross-Volume References** chapter explicitly linking Vol 3 sections to Vol 2 (business), Vol 4 (technical), Vol 5 (engineering), Vol 7 (governance).
- Flag anything that Volume 4 (technical), Volume 5 (engineering), or Volume 7 (governance/AI safety) must implement.

## 9. Writing Standards

- Internal Microsoft architecture-strategy register; avoid hype and vendor puffery.
- Every recommendation must be implementable by the named engineering/AI teams.
- Include banking and UPI examples where relevant.
- Include assumptions, trade-offs, alternatives considered, and recommendations in each chapter.

## 10. Acceptance Criteria

The output is acceptable only if: (a) it is detailed enough for the AI/ML platform, engineering, security, and executive teams to build the cognitive layer from it; (b) all five mandatory diagrams render; (c) the decision engine faithfully implements the Vol 2 taxonomy and the ₹10L hard-limit; (d) every cognitive faculty ties to at least one Vol 2 workflow/agent; and (e) the document reproduces the Vol 1/2 scaffolding (document control, exec summary, cross-volume refs, glossary, summary, footer).
