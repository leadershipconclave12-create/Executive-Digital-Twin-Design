// Package domain is the shared EIOS vocabulary (ported faithfully from the
// TypeScript prototype's server/src/domain/types.ts). JSON tags match the exact
// camelCase keys the web UI consumes, so the existing UI works unchanged.
package domain

// --- Identity (single user) -------------------------------------------------

type Role = string

const RoleDeputyChief Role = "deputy_chief"

type User struct {
	ID                    string `json:"id"`
	Name                  string `json:"name"`
	Role                  Role   `json:"role"`
	Title                 string `json:"title"`
	FinancialAuthorityInr int64  `json:"financialAuthorityInr"`
}

// --- Signals ----------------------------------------------------------------

type Signal struct {
	ID              string `json:"id"`
	Source          string `json:"source"`
	Title           string `json:"title"`
	Summary         string `json:"summary"`
	Priority        string `json:"priority"` // informational|routine|critical|urgent
	ReceivedAt      string `json:"receivedAt"`
	SuggestedAction string `json:"suggestedAction"`
	Agent           string `json:"agent"`
	Handled         bool   `json:"handled"`
}

// --- Channels ---------------------------------------------------------------

type ChannelHealth struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	MetricLabel string  `json:"metricLabel"`
	Value       string  `json:"value"`
	SuccessRate float64 `json:"successRate"`
	Status      string  `json:"status"` // healthy|degraded|critical
	Note        string  `json:"note"`
}

// --- Incidents --------------------------------------------------------------

type Incident struct {
	ID             string `json:"id"`
	Severity       string `json:"severity"` // P1|P2|P3
	Title          string `json:"title"`
	Service        string `json:"service"`
	OpenedAt       string `json:"openedAt"`
	Owner          string `json:"owner"`
	Status         string `json:"status"`
	CustomerImpact string `json:"customerImpact"`
}

// --- Decisions --------------------------------------------------------------

type DecisionItem struct {
	ID                string   `json:"id"`
	Type              string   `json:"type"`
	Domain            string   `json:"domain"`
	Tier              string   `json:"tier"` // Autonomous|Supervised|Human-Required
	Risk              string   `json:"risk"` // Low|Medium|High|Critical
	Summary           string   `json:"summary"`
	Recommendation    string   `json:"recommendation"`
	AmountInr         int64    `json:"amountInr,omitempty"`
	AmountLabel       string   `json:"amountLabel,omitempty"`
	Confidence        float64  `json:"confidence"`
	Status            string   `json:"status"` // pending|approved|rejected|auto-executed
	RequiredApprovers []string `json:"requiredApprovers"`
	DecidedBy         string   `json:"decidedBy,omitempty"`
	DecidedAt         string   `json:"decidedAt,omitempty"`
	Rationale         string   `json:"rationale,omitempty"`
}

// --- Delegations ------------------------------------------------------------

type Delegation struct {
	ID             string `json:"id"`
	Delegator      string `json:"delegator"`
	Delegate       string `json:"delegate"`
	Subject        string `json:"subject"`
	Context        string `json:"context,omitempty"`
	AuthorityLevel string `json:"authorityLevel"` // L1..L5
	AuthorityNote  string `json:"authorityNote"`
	SpendCapInr    int64  `json:"spendCapInr,omitempty"`
	Priority       string `json:"priority"` // Low|Medium|High
	Deadline       string `json:"deadline"`
	Status         string `json:"status"` // Notified|In Progress|At Risk|Completed|Escalated
	Progress       int    `json:"progress"`
	CreatedAt      string `json:"createdAt"`
}

// --- KPIs -------------------------------------------------------------------

type Kpi struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Level  string `json:"level"`
	Value  string `json:"value"`
	Target string `json:"target"`
	Trend  string `json:"trend"` // up|down|flat
	Good   string `json:"good"`  // up|down
}

// --- Agents -----------------------------------------------------------------

type Agent struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Charter         string   `json:"charter"`
	AutonomyCeiling string   `json:"autonomyCeiling"`
	OwnsWorkflows   []string `json:"ownsWorkflows"`
	Status          string   `json:"status"` // active|idle
}

// --- Knowledge graph --------------------------------------------------------

type KgNode struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Label string `json:"label"`
}
type KgEdge struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Relation string `json:"relation"`
}
type KnowledgeGraph struct {
	Nodes []KgNode `json:"nodes"`
	Edges []KgEdge `json:"edges"`
}

// --- Audit ------------------------------------------------------------------

type AuditEvent struct {
	Seq       int    `json:"seq"`
	Timestamp string `json:"timestamp"`
	Actor     string `json:"actor"`
	ActorRole string `json:"actorRole"`
	Action    string `json:"action"`
	Resource  string `json:"resource"`
	Detail    string `json:"detail"`
	PrevHash  string `json:"prevHash"`
	Hash      string `json:"hash"`
}

// --- Overview DTO (GET /api/overview) ---------------------------------------

type Executive struct {
	Name string `json:"name"`
	Org  string `json:"org"`
	Date string `json:"date"`
}
type Briefing struct {
	Headline string   `json:"headline"`
	Bullets  []string `json:"bullets"`
}
type Overview struct {
	Executive Executive       `json:"executive"`
	Briefing  Briefing        `json:"briefing"`
	Kpis      []Kpi           `json:"kpis"`
	Channels  []ChannelHealth `json:"channels"`
	Incidents []Incident      `json:"incidents"`
}
