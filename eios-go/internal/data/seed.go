// Package data holds the initial known state of the organization and the mutable
// working Store. Ported verbatim from the prototype's server/src/data/seed.ts —
// every value preserved so nothing showcased is lost. These are *initial* values
// for a system built to take real feeds from day one, not a frozen mock: the
// Store is mutated live by ingestion, decisions, delegations and the heartbeat.
package data

import "eios/internal/domain"

// The one and only user (governance/rbac.ts).
func DeputyChief() domain.User {
	return domain.User{
		ID:                    "u-dc",
		Name:                  "Deputy Chief",
		Role:                  domain.RoleDeputyChief,
		Title:                 "Deputy Chief (Products)",
		FinancialAuthorityInr: 50_000_000,
	}
}

func Briefing() domain.Briefing {
	return domain.Briefing{
		Headline: "One thing needs you before 10:00; everything else is in hand.",
		Bullets: []string{
			"UPI success rate is 97.1% (below the 99% floor) — INC-4521 on AxisPay, VP – IT Operations mitigating, ETA 12:00.",
			"Three decisions are queued: AxisPay SLA notice (DT-009), Akamai CDN renewal (DT-007, ₹1.2Cr), RBI tokenisation plan (DT-010).",
			"Release 18 (Payments Core) ships in 6 days at 71% readiness — Delivery Office is watching it.",
		},
	}
}

func Channels() []domain.ChannelHealth {
	return []domain.ChannelHealth{
		{ID: "upi", Name: "UPI", MetricLabel: "Success rate", Value: "97.1%", SuccessRate: 97.1, Status: "degraded", Note: "PSP AxisPay degradation (INC-4521). Below the 99% threshold."},
		{ID: "imps", Name: "IMPS", MetricLabel: "Success rate", Value: "99.6%", SuccessRate: 99.6, Status: "healthy", Note: "Within tolerance."},
		{ID: "neft", Name: "NEFT", MetricLabel: "Success rate", Value: "99.8%", SuccessRate: 99.8, Status: "healthy", Note: "Within tolerance."},
		{ID: "rtgs", Name: "RTGS", MetricLabel: "Success rate", Value: "99.9%", SuccessRate: 99.9, Status: "healthy", Note: "Within tolerance."},
		{ID: "mobile", Name: "Mobile Banking", MetricLabel: "Success rate", Value: "99.4%", SuccessRate: 99.4, Status: "healthy", Note: "Within tolerance."},
	}
}

func Incidents() []domain.Incident {
	return []domain.Incident{
		{ID: "INC-4521", Severity: "P2", Title: "UPI latency / success-rate degradation", Service: "UPI Switch (AxisPay PSP)", OpenedAt: "2026-07-16T06:05:00Z", Owner: "VP – IT Operations", Status: "Mitigating", CustomerImpact: "~2.9% of UPI transactions slow or failing since 06:01 IST."},
		{ID: "INC-4498", Severity: "P3", Title: "Intermittent push-notification delays", Service: "Mobile Banking", OpenedAt: "2026-07-15T14:20:00Z", Owner: "EM – Mobile", Status: "Monitoring", CustomerImpact: "Cosmetic; no transaction impact."},
	}
}

func Kpis() []domain.Kpi {
	return []domain.Kpi{
		{ID: "KPI-UPI", Name: "UPI success rate", Level: "L0", Value: "97.1%", Target: "≥ 99%", Trend: "down", Good: "up"},
		{ID: "KPI-NPS", Name: "Digital NPS", Level: "L1", Value: "41", Target: "≥ 45", Trend: "down", Good: "up"},
		{ID: "KPI-REL", Name: "Release on-time rate", Level: "L1", Value: "86%", Target: "≥ 90%", Trend: "flat", Good: "up"},
		{ID: "KPI-COST", Name: "Cost per digital txn", Level: "L2", Value: "₹0.38", Target: "≤ ₹0.40", Trend: "down", Good: "down"},
	}
}

func Decisions() []domain.DecisionItem {
	return []domain.DecisionItem{
		{ID: "DT-004", Type: "Vendor payment release", Domain: "Procurement", Tier: "Supervised", Risk: "Low", Summary: "Release Q1 milestone payment to AxisPay (₹18L) — already approved yesterday.", Recommendation: "Approved and disbursed.", AmountInr: 1_800_000, AmountLabel: "₹18L", Confidence: 0.91, Status: "approved", RequiredApprovers: []string{"Deputy Chief (Products)"}, DecidedBy: "Deputy Chief", DecidedAt: "2026-07-15T11:02:00Z", Rationale: "Milestone evidence verified by Finance."},
		{ID: "DT-007", Type: "CDN contract renewal", Domain: "Infrastructure", Tier: "Human-Required", Risk: "Medium", Summary: "Renew Akamai CDN for 12 months. Current contract expires in 12 days.", Recommendation: "Approve — renewal terms flat YoY; no viable migration window before expiry.", AmountInr: 12_000_000, AmountLabel: "₹1.2Cr", Confidence: 0.88, Status: "pending", RequiredApprovers: []string{"Deputy Chief (Products)", "Risk / Compliance sign-off"}},
		{ID: "DT-009", Type: "SLA breach notice", Domain: "Vendor management", Tier: "Supervised", Risk: "Medium", Summary: "Issue a formal SLA breach notice to AxisPay — 3rd breach this quarter (INC-4521).", Recommendation: "Approve — withhold ₹1.2L per the contract penalty clause.", AmountInr: 120_000, AmountLabel: "₹1.2L", Confidence: 0.9, Status: "pending", RequiredApprovers: []string{"Deputy Chief (Products)"}},
		{ID: "DT-010", Type: "Regulatory implementation plan", Domain: "Compliance", Tier: "Human-Required", Risk: "High", Summary: "Adopt the RBI/2026-27/44 tokenisation implementation plan — 90-day window, ~6 sprints.", Recommendation: "Approve the plan; Compliance Eng to own delivery against the 90-day clock.", Confidence: 0.83, Status: "pending", RequiredApprovers: []string{"Deputy Chief (Products)", "Risk / Compliance sign-off"}},
	}
}

func Delegations() []domain.Delegation {
	return []domain.Delegation{
		{ID: "DEL-2026-07-15-0041", Delegator: "Deputy Chief", Delegate: "EM – Mobile", Subject: "Close out INC-4498 push-notification delays", Context: "P3; cosmetic; monitor 24h", AuthorityLevel: "L2", AuthorityNote: "Recommend", Priority: "Low", Deadline: "EOD", Status: "In Progress", Progress: 60, CreatedAt: "2026-07-15T15:00:00Z"},
		{ID: "DEL-2026-07-15-0042", Delegator: "Deputy Chief", Delegate: "EM – Compliance Eng", Subject: "Scope RBI/2026-27/44 tokenisation impact", Context: "RBI-44; 2 systems flagged", AuthorityLevel: "L1", AuthorityNote: "Investigate", Priority: "Medium", Deadline: "2026-07-18", Status: "Notified", Progress: 5, CreatedAt: "2026-07-15T16:30:00Z"},
	}
}

func Signals() []domain.Signal {
	return []domain.Signal{
		{ID: "SIG-1", Source: "Alert", Title: "UPI success rate below threshold (97.1%)", Summary: "AxisPay PSP degradation; INC-4521 open, VP – IT Operations mitigating.", Priority: "urgent", ReceivedAt: "2026-07-16T06:06:00Z", SuggestedAction: "Delegate INC-4521 to VP – IT Operations (L3, ₹5L cap).", Agent: "Operations Agent", Handled: false},
		{ID: "SIG-2", Source: "RBI", Title: "RBI/2026-27/44 — card tokenisation circular", Summary: "90-day compliance window; 2 systems affected (~6 sprints).", Priority: "critical", ReceivedAt: "2026-07-16T05:40:00Z", SuggestedAction: "Review and approve implementation plan (DT-010).", Agent: "Compliance Agent", Handled: false},
		{ID: "SIG-3", Source: "ServiceNow", Title: "AxisPay — 3rd SLA breach this quarter", Summary: "Contractual penalty clause triggered; DT-009 queued.", Priority: "critical", ReceivedAt: "2026-07-16T06:10:00Z", SuggestedAction: "Approve formal SLA breach notice (DT-009).", Agent: "Vendor Agent", Handled: false},
		{ID: "SIG-4", Source: "Teams", Title: "Release 18 readiness at 71%", Summary: "Payments Core ships in 6 days; Delivery Office tracking risk 58.", Priority: "routine", ReceivedAt: "2026-07-16T04:15:00Z", SuggestedAction: "No action yet — checkpoint at T-3 days.", Agent: "Delivery Agent", Handled: false},
		{ID: "SIG-5", Source: "Email", Title: "Weekly product metrics digest", Summary: "NPS 41 (-3), app rating 4.3 (-2%), merchant complaints +34%.", Priority: "informational", ReceivedAt: "2026-07-16T03:00:00Z", SuggestedAction: "Read at your convenience.", Agent: "Insights Agent", Handled: false},
	}
}

func Agents() []domain.Agent {
	return []domain.Agent{
		{ID: "AG-OPS", Name: "Operations Agent", Charter: "Watch channel health and incidents; propose delegations.", AutonomyCeiling: "Supervised", OwnsWorkflows: []string{"AW-01", "AW-02"}, Status: "active"},
		{ID: "AG-VENDOR", Name: "Vendor Agent", Charter: "Track SLAs, breaches and renewals; draft notices.", AutonomyCeiling: "Supervised", OwnsWorkflows: []string{"AW-05"}, Status: "active"},
		{ID: "AG-COMPLIANCE", Name: "Compliance Agent", Charter: "Monitor RBI/NPCI circulars; map to systems and sprints.", AutonomyCeiling: "Human-Required", OwnsWorkflows: []string{"AW-08"}, Status: "active"},
		{ID: "AG-DELIVERY", Name: "Delivery Agent", Charter: "Track releases and project risk against plan.", AutonomyCeiling: "Supervised", OwnsWorkflows: []string{"AW-03"}, Status: "active"},
		{ID: "AG-INSIGHTS", Name: "Insights Agent", Charter: "Summarise product metrics and customer signals.", AutonomyCeiling: "Autonomous", OwnsWorkflows: []string{"AW-11"}, Status: "idle"},
	}
}

func KnowledgeGraph() domain.KnowledgeGraph {
	return domain.KnowledgeGraph{
		Nodes: []domain.KgNode{
			{ID: "INC-4521", Type: "Incident", Label: "UPI degradation"},
			{ID: "VEND-AXIS", Type: "Vendor", Label: "AxisPay (UPI PSP)"},
			{ID: "DT-009", Type: "Decision", Label: "AxisPay SLA notice"},
			{ID: "DT-007", Type: "Decision", Label: "Akamai CDN renewal"},
			{ID: "VEND-AKAMAI", Type: "Vendor", Label: "Akamai (CDN)"},
			{ID: "SYS-UPI", Type: "System", Label: "UPI Switch"},
			{ID: "RBI-44", Type: "Regulation", Label: "RBI/2026-27/44 Tokenisation"},
			{ID: "DT-010", Type: "Decision", Label: "RBI tokenisation plan"},
			{ID: "VP-ITOPS", Type: "Person", Label: "VP – IT Operations"},
		},
		Edges: []domain.KgEdge{
			{From: "INC-4521", To: "VEND-AXIS", Relation: "caused_by"},
			{From: "INC-4521", To: "SYS-UPI", Relation: "affects"},
			{From: "DT-009", To: "VEND-AXIS", Relation: "targets"},
			{From: "INC-4521", To: "VP-ITOPS", Relation: "owned_by"},
			{From: "DT-007", To: "VEND-AKAMAI", Relation: "renews"},
			{From: "DT-010", To: "RBI-44", Relation: "implements"},
		},
	}
}
