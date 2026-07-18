package agent

import (
	"encoding/json"
	"strings"
	"time"
)

// Screen context — the richest cheap signal for "what is he working on right
// now": the window in front of him, what's on his clipboard, and which apps he
// has been living in today. All local, all already his.

// clipScript reads the clipboard as text. Kept inline (tiny) rather than a file.
const clipScript = `$ErrorActionPreference='SilentlyContinue'
$t = Get-Clipboard -Raw
if ($null -eq $t) { $t = "" }
if ($t.Length -gt 1200) { $t = $t.Substring(0,1200) }
[pscustomobject]@{ text = $t } | ConvertTo-Json -Compress`

// Context is the composed "working on" picture.
type Context struct {
	Supported     bool     `json:"supported"`
	ActiveApp     string   `json:"activeApp"`
	ActiveTitle   string   `json:"activeTitle"`
	ActiveKey     string   `json:"activeKey"`
	ActiveSince   string   `json:"activeSince"`
	Clipboard     string   `json:"clipboard"`
	ClipboardKind string   `json:"clipboardKind"` // empty | text | url | number | email
	RecentApps    []AppUse `json:"recentApps"`
	Inference     string   `json:"inference"` // a plain-language read of what he's doing
	ReadAt        string   `json:"readAt"`
}

// ReadContext blends the live activity snapshot with the clipboard.
func ReadContext(a *Agent) Context {
	snap := a.Snapshot()
	ctx := Context{
		Supported:   snap.Supported,
		ActiveApp:   snap.ActiveApp,
		ActiveTitle: snap.ActiveTitle,
		ActiveKey:   snap.ActiveKey,
		ActiveSince: snap.ActiveSince,
		RecentApps:  snap.Today,
		ReadAt:      time.Now().UTC().Format(time.RFC3339),
	}
	if len(ctx.RecentApps) > 6 {
		ctx.RecentApps = ctx.RecentApps[:6]
	}

	if out, err := runPowerShell(clipScript, 8*time.Second); err == nil && len(out) > 0 {
		var c struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(out, &c) == nil {
			ctx.Clipboard = strings.TrimSpace(c.Text)
			ctx.ClipboardKind = classifyClip(ctx.Clipboard)
		}
	}
	ctx.Inference = inferWork(ctx)
	return ctx
}

func classifyClip(s string) string {
	if s == "" {
		return "empty"
	}
	switch {
	case strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://"):
		return "url"
	case strings.Contains(s, "@") && !strings.ContainsAny(s, " \n\t") && strings.Contains(s, "."):
		return "email"
	case isNumeric(s):
		return "number"
	default:
		return "text"
	}
}

func isNumeric(s string) bool {
	seen := false
	for _, r := range s {
		if r >= '0' && r <= '9' {
			seen = true
			continue
		}
		if r == ',' || r == '.' || r == ' ' || r == '₹' || r == '-' {
			continue
		}
		return false
	}
	return seen
}

// inferWork turns the raw signals into one honest sentence.
func inferWork(c Context) string {
	if !c.Supported {
		return "Screen context needs the local agent on Windows."
	}
	app := c.ActiveApp
	if app == "" {
		app = "his desktop"
	}
	title := strings.TrimSpace(c.ActiveTitle)
	switch c.ActiveKey {
	case AppOutlook:
		return "Working in Outlook" + titleClause(title) + "."
	case AppTeams:
		return "In Teams" + titleClause(title) + "."
	case AppCalendar:
		return "Looking at the calendar" + titleClause(title) + "."
	}
	if title != "" {
		return "Working in " + app + " — “" + title + "”."
	}
	return "Working in " + app + "."
}

func titleClause(t string) string {
	if t == "" {
		return ""
	}
	return " — “" + t + "”"
}
