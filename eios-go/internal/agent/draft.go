package agent

import (
	_ "embed"
	"encoding/json"
	"time"
)

//go:embed draft_mail.ps1
var draftMailScript string

// DraftRequest is what the twin (or the executive) asks to be drafted.
type DraftRequest struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	ReplyTo string `json:"replyTo"` // EntryID of the message being answered
}

// DraftResult is honest about what happened. It is ONLY ever a draft — the twin
// has no path to Send. Created=false carries a reason and a fix.
type DraftResult struct {
	Created bool   `json:"created"`
	Reason  string `json:"reason,omitempty"`
	Error   string `json:"error,omitempty"`
	Fix     string `json:"fix,omitempty"`
	EntryID string `json:"entryId,omitempty"`
	Subject string `json:"subject,omitempty"`
	To      string `json:"to,omitempty"`
	SavedTo string `json:"savedTo,omitempty"`
	At      string `json:"at,omitempty"`
}

// DraftMail creates a reply/new draft in his Outlook Drafts folder. It writes,
// but only ever a draft: the send decision stays with him.
func DraftMail(req DraftRequest) DraftResult {
	out, err := runPowerShell(draftMailScript, 45*time.Second,
		"-To", req.To, "-Subject", req.Subject, "-Body", req.Body, "-ReplyTo", req.ReplyTo)
	if err == errUnsupportedOS {
		return DraftResult{Created: false, Reason: "unsupported_os",
			Error: "Outlook COM is Windows-only; run the agent on his laptop."}
	}
	if err != nil && len(out) == 0 {
		return DraftResult{Created: false, Error: "could not create the draft: " + err.Error()}
	}
	var res DraftResult
	if e := json.Unmarshal(out, &res); e != nil {
		return DraftResult{Created: false, Error: "unexpected draft output: " + e.Error()}
	}
	if res.Created {
		res.At = time.Now().UTC().Format(time.RFC3339)
	}
	return res
}
