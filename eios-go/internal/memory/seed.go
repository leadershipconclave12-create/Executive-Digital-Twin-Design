package memory

// The organization's recorded memory. In production this is backfilled from the
// decision journal, post-incident reviews and 1:1 notes. The shape is what
// matters: every record carries provenance, sensitivity and a lifecycle, and the
// causal edges are what make recall answerable without a model.

func cd(overall float64, limitedBy, expl string) ConfidenceDetail {
	return ConfidenceDetail{
		Evidence: overall, Reasoning: overall, Policy: 0.9, Freshness: 0.85,
		HumanValidation: "validated", Overall: overall, LimitedBy: limitedBy, Explanation: expl,
	}
}

func prov(src, by, conf, at string) Provenance {
	return Provenance{Source: src, RecordedAt: at, RecordedBy: by, Confidence: conf}
}

// Seed builds the fabric.
func Seed() *Fabric {
	f := New()

	// ---- THE FLAGSHIP: why did we reject XYZ Bank's proposal? --------------
	f.Add(Node{
		ID: "D-193", Kind: "decision", Title: "Rejected XYZ Bank's co-branded UPI proposal",
		At: "2026-03-14T10:30:00Z", EntityRef: "PRJ-A",
		Summary: "We rejected XYZ Bank's co-branded UPI partnership proposal on 14 March 2026.",
		Tags:    []string{"xyz", "xyz bank", "partnership", "upi", "co-brand", "proposal", "reject"},
		Rationale: []string{
			"Merchant adoption risk — XYZ's merchant base overlaps ours by 61%; net new reach was ~9%.",
			"Fraud concern — their KYC refresh cycle is 24 months against our 12; shared rails inherit the weaker control.",
			"Engineering estimate doubled — from 4 to 8 sprints once tokenisation scope was included.",
			"Risk Committee approval absent — no sign-off was obtained before the commercial deadline.",
		},
		Alternatives: []Alternative{
			{Option: "White-label their front-end onto our rails", Why: "Would have put our licence behind their KYC standard."},
			{Option: "Pilot in two circles only", Why: "Commercials required national exclusivity from day one."},
			{Option: "Defer to next quarter", Why: "Their board deadline was 31 March; deferral was a rejection in practice."},
		},
		Quote:            "We'll revisit after NPCI publishes the new circular.",
		RevisitCondition: "NPCI publishes the revised co-branding circular.",
		RevisitMet:       false,
		RevisitNote:      "The NPCI circular has not been published as of today — the revisit condition has NOT been met.",
		Provenance: Provenance{Source: "decision-journal", RecordedAt: "2026-03-14T10:30:00Z",
			RecordedBy: "Deputy Chief", Confidence: Stated,
			Quote: "We'll revisit after NPCI publishes the new circular."},
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.94, "human", "Stated by the executive and recorded with rationale in the journal."),
	})
	f.Add(Node{
		ID: "EV-190", Kind: "episode", Title: "Risk Committee sign-off never obtained", At: "2026-03-12T09:00:00Z",
		Summary: "The XYZ proposal reached the commercial deadline without Risk Committee approval.",
		Tags:    []string{"risk", "committee", "approval", "xyz", "governance"},
		Provenance: prov("governance-log", "Chief of Staff", Stated, "2026-03-12T09:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.9, "human", "Recorded in the governance log."),
	})
	f.Add(Node{
		ID: "EV-188", Kind: "episode", Title: "Engineering estimate doubled to 8 sprints", At: "2026-03-08T14:00:00Z",
		Summary: "Adding tokenisation scope doubled the XYZ integration estimate from 4 to 8 sprints.",
		Tags:    []string{"engineering", "estimate", "xyz", "tokenisation", "sprints"},
		Provenance: prov("engineering-review", "EM – UPI Platform", Derived, "2026-03-08T14:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.78, "freshness", "Derived from a sprint-level re-estimate; not re-validated since."),
	})
	f.Link("D-193", "blocked_by", "EV-190")
	f.Link("D-193", "considered", "EV-188")
	f.Link("D-193", "about", "PRJ-A")

	// ---- Organizational scar 1: the Diwali outage -------------------------
	f.Add(Node{
		ID: "EV-301", Kind: "episode", Title: "Diwali outage — UPI switch overloaded",
		At: "2025-11-12T19:40:00Z", EntityRef: "SYS-UPI",
		Summary: "The UPI switch overloaded during Diwali peak; a festival-day deploy had gone out that morning.",
		Tags:    []string{"diwali", "outage", "festival", "switch", "upi", "capacity", "deploy"},
		Provenance: prov("post-incident-review", "VP – IT Operations", Stated, "2025-11-13T09:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.96, "human", "Root cause agreed in the post-incident review."),
	})
	f.Add(Node{
		ID: "EV-302", Kind: "episode", Title: "4.2M customers impacted", At: "2025-11-12T20:10:00Z",
		Summary: "Customers impacted: 4.2M failed or delayed transactions over 3 hours.",
		Tags:    []string{"diwali", "customers", "impact", "outage"},
		Provenance: prov("telemetry", "EIOS", Derived, "2025-11-13T02:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.88, "evidence", "Derived from switch telemetry."),
	})
	f.Add(Node{
		ID: "EV-303", Kind: "episode", Title: "CEO review called", At: "2025-11-14T11:00:00Z",
		Summary: "The CEO called a review of digital channel resilience following the outage.",
		Tags:    []string{"ceo", "review", "diwali", "escalation"},
		Provenance: prov("exec-office", "Chief of Staff", Stated, "2025-11-14T11:00:00Z"),
		Sensitivity: Restricted, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.92, "human", "Recorded by the executive office."),
	})
	f.Add(Node{
		ID: "L-1", Kind: "lesson", Title: "Festival freeze", At: "2025-11-20T00:00:00Z",
		Summary: "Freeze deploys around festivals; capacity-test PSPs before peak.",
		Tags:    []string{"deploy", "festival", "capacity", "upi", "release", "freeze", "lessons"},
		Rule:    "Freeze deploys around festivals; capacity-test PSPs before peak.",
		Scar:    "Diwali outage — switch overloaded, 4.2M customers impacted, CEO review.",
		Provenance: prov("post-incident-review", "Deputy Chief", Stated, "2025-11-20T00:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.95, "human", "Ratified after the Diwali post-incident review."),
	})
	f.Link("EV-301", "caused", "EV-302")
	f.Link("EV-302", "led_to", "EV-303")
	f.Link("L-1", "learned_from", "EV-301")

	// ---- Organizational scar 2: Release 15 --------------------------------
	f.Add(Node{
		ID: "EV-210", Kind: "episode", Title: "Release 15 delayed two weeks", At: "2026-02-02T00:00:00Z",
		EntityRef: "PRJ-A",
		Summary:   "Release 15 slipped two weeks; the slip was not disclosed to stakeholders until it landed.",
		Tags:      []string{"release", "release 15", "delay", "delivery", "disclosure"},
		Provenance: prov("delivery-log", "EM – UPI Platform", Stated, "2026-02-02T00:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.9, "human", "Recorded in the delivery log."),
	})
	f.Add(Node{
		ID: "EV-211", Kind: "episode", Title: "Merchant complaints spiked", At: "2026-02-09T00:00:00Z",
		Summary: "Merchant complaints rose 34% in the fortnight after the Release 15 slip.",
		Tags:    []string{"complaints", "merchant", "release 15"},
		Provenance: prov("support-analytics", "EIOS", Derived, "2026-02-10T00:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.84, "evidence", "Derived from support ticket volume."),
	})
	f.Add(Node{
		ID: "EV-212", Kind: "episode", Title: "Churn in the affected merchant cohort", At: "2026-02-16T00:00:00Z",
		Summary: "Churn in the affected merchant cohort reached 2.1% — roughly 3x baseline.",
		Tags:    []string{"churn", "merchant", "release 15", "revenue"},
		Provenance: prov("revenue-analytics", "EIOS", Derived, "2026-02-17T00:00:00Z"),
		Sensitivity: Restricted, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.8, "evidence", "Derived from cohort revenue analysis."),
	})
	f.Add(Node{
		ID: "EV-213", Kind: "episode", Title: "CEO escalation on delivery predictability",
		At: "2026-02-20T00:00:00Z",
		Summary: "The CEO escalated on delivery predictability and asked for early-warning discipline.",
		Tags:    []string{"ceo", "escalation", "delivery", "release 15"},
		Provenance: prov("exec-office", "Chief of Staff", Stated, "2026-02-20T00:00:00Z"),
		Sensitivity: Restricted, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.92, "human", "Recorded by the executive office."),
	})
	f.Add(Node{
		ID: "L-2", Kind: "lesson", Title: "Disclose delivery risk early", At: "2026-02-24T00:00:00Z",
		Summary: "Disclose delivery risk early — silence compounds churn.",
		Tags:    []string{"delivery", "release", "disclosure", "risk", "miss", "delay", "lessons"},
		Rule:    "Disclose delivery risk early — silence compounds churn.",
		Scar:    "Release 15 delay → complaints → 2.1% churn → CEO escalation.",
		// The RULE is shareable even though the records it was learned from are not.
		Provenance: prov("post-mortem", "Deputy Chief", Stated, "2026-02-24T00:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.93, "human", "Ratified in the Release 15 post-mortem."),
	})
	f.Link("EV-210", "caused", "EV-211")
	f.Link("EV-211", "led_to", "EV-212")
	f.Link("EV-212", "led_to", "EV-213")
	f.Link("L-2", "learned_from", "EV-212")
	f.Link("L-2", "learned_from", "EV-213")

	// ---- This executive's own judgment ------------------------------------
	f.Add(Node{
		ID: "J-1", Kind: "judgment", Title: "Vendor SLA breaches", At: "2026-04-02T00:00:00Z",
		Summary:  "On a third SLA breach he issues the formal notice rather than escalating verbally.",
		Tags:     []string{"vendor", "sla", "breach", "notice", "axispay"},
		Trigger:  "a vendor reaches a third SLA breach in a quarter",
		Judgment: "issue the formal contractual notice immediately; do not rely on a relationship call",
		Because:  "verbal escalation with AxisPay in Q3 produced no change and cost us the penalty window",
		Provenance: prov("decision-journal", "Deputy Chief", Stated, "2026-04-02T00:00:00Z"),
		Sensitivity: Open, Layer: "executive", Lifecycle: "active",
		Confidence:  cd(0.9, "human", "Consistent across three recorded decisions."),
	})

	// ---- Personal: his own notes. Readable by him, NEVER sent to a model ---
	f.Add(Node{
		ID: "PE-B", Kind: "person", Title: "1:1 coaching notes — EM – UPI Platform",
		At: "2026-07-01T00:00:00Z", EntityRef: "EM-B",
		Summary: "Coaching notes: strong technically, over-commits under pressure; load index sustained above 85.",
		Tags:    []string{"em-b", "coaching", "1:1", "people", "upi"},
		Provenance: prov("1:1-notes", "Deputy Chief", Stated, "2026-07-01T00:00:00Z"),
		Sensitivity: Personal, Layer: "executive", Lifecycle: "active",
		Confidence:  cd(0.85, "human", "The executive's own notes."),
	})
	f.Add(Node{
		ID: "PRJ-A", Kind: "project", Title: "UPI Autoscale Programme", At: "2026-01-10T00:00:00Z",
		EntityRef: "PRJ-A",
		Summary:   "Programme to autoscale the UPI switch ahead of festival peaks. Owner: EM – UPI Platform.",
		Tags:      []string{"upi", "autoscale", "programme", "capacity", "prj-a"},
		Provenance: prov("portfolio", "Chief of Staff", Stated, "2026-01-10T00:00:00Z"),
		Sensitivity: Open, Layer: "organizational", Lifecycle: "active",
		Confidence:  cd(0.9, "human", "Portfolio record."),
	})
	f.Link("PE-B", "concerns", "PRJ-A")
	f.Link("PRJ-A", "about", "SYS-UPI")

	return f
}
