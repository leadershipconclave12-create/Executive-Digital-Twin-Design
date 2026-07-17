// Package agent is the LOCAL laptop agent — the piece that turns the twin from a
// simulation into his actual Thursday. It runs as him, on his machine, and reads
// only what he already has the right to read:
//
//   activity  — which app/window is in front of him right now (user32 syscalls)
//   outlook   — his real mailbox, via Outlook's local COM interface
//   files     — his recent documents
//
// DELIBERATELY NOT MICROSOFT GRAPH. Graph needs an Entra app registration plus
// tenant-wide admin consent — a project he cannot get on a locked-down bank
// laptop. Outlook's COM automation is the same data, already on the machine,
// already his, with no ticket and no new grant to anyone.
//
// Nothing here leaves the machine on its own: the agent only writes into the
// local twin. Egress is governed elsewhere (llm redaction + the LLM_ACCESS gate).
package agent

import (
	"sort"
	"sync"
	"time"
)

// AppKey matches the app nodes the Assistant home draws.
type AppKey = string

const (
	AppOutlook  AppKey = "outlook"
	AppTeams    AppKey = "teams"
	AppCalendar AppKey = "calendar"
	AppOneDrive AppKey = "onedrive"
	AppToDo     AppKey = "todo"
	AppPlanner  AppKey = "planner"
	AppOther    AppKey = "other"
)

// processMap maps a Windows process image name to one of the app nodes.
// Lowercase keys; matched case-insensitively.
var processMap = map[string]AppKey{
	"outlook.exe":     AppOutlook,
	"olk.exe":         AppOutlook, // new Outlook
	"ms-teams.exe":    AppTeams,
	"teams.exe":       AppTeams,
	"onedrive.exe":    AppOneDrive,
	"todo.exe":        AppToDo,
	"microsoft.todos": AppToDo,
	"planner.exe":     AppPlanner,
	"winword.exe":     AppOther,
	"excel.exe":       AppOther,
	"powerpnt.exe":    AppOther,
	"onenote.exe":     AppOther,
}

// AppUse is time-on-app for today.
type AppUse struct {
	Key     AppKey `json:"key"`
	Name    string `json:"name"`
	Process string `json:"process"`
	Seconds int    `json:"seconds"`
}

// Activity is what the Assistant home renders to show his real apps.
type Activity struct {
	// Supported is false on non-Windows or if the syscalls are unavailable.
	Supported bool `json:"supported"`
	// Watching is true once the poller is running.
	Watching    bool     `json:"watching"`
	ActiveKey   AppKey   `json:"activeKey"`
	ActiveApp   string   `json:"activeApp"`
	ActiveTitle string   `json:"activeTitle"`
	ActiveSince string   `json:"activeSince"`
	Today       []AppUse `json:"today"`
	Note        string   `json:"note"`
}

var friendly = map[AppKey]string{
	AppOutlook: "Outlook", AppTeams: "Teams", AppCalendar: "Calendar",
	AppOneDrive: "OneDrive", AppToDo: "To Do", AppPlanner: "Planner", AppOther: "Other",
}

// Agent owns the local observations.
type Agent struct {
	mu sync.RWMutex

	supported bool
	watching  bool
	note      string

	curKey     AppKey
	curApp     string
	curProc    string
	curTitle   string
	curSince   time.Time
	// accrued in milliseconds — polling is sub-second, so integer seconds would
	// truncate every sample to zero and nothing would ever accumulate.
	millis     map[AppKey]int64
	procOfKey  map[AppKey]string
	lastSample time.Time
}

func New() *Agent {
	return &Agent{
		millis:    map[AppKey]int64{},
		procOfKey: map[AppKey]string{},
		supported: activitySupported(),
	}
}

// Watch starts polling the foreground window. Safe to call once.
func (a *Agent) Watch(every time.Duration) {
	if !a.supported {
		a.mu.Lock()
		a.note = "Activity watching needs Windows — the graph shows the simulation instead."
		a.mu.Unlock()
		return
	}
	a.mu.Lock()
	a.watching = true
	a.lastSample = time.Now()
	a.mu.Unlock()
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for range t.C {
			a.sample()
		}
	}()
}

func (a *Agent) sample() {
	proc, title, err := foregroundApp()
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()

	// credit elapsed time to whatever was in front of him. Ignore gaps > 5 min
	// (laptop asleep / locked) so an overnight suspend doesn't land on one app.
	elapsed := now.Sub(a.lastSample).Milliseconds()
	if elapsed > 0 && elapsed < 5*60*1000 && a.curKey != "" {
		a.millis[a.curKey] += elapsed
	}
	a.lastSample = now
	if err != nil {
		a.note = "Could not read the foreground window: " + err.Error()
		return
	}
	key := keyFor(proc)
	if key != a.curKey || title != a.curTitle {
		a.curSince = now
	}
	a.curKey, a.curProc, a.curTitle = key, proc, title
	// For apps we don't map to a node, show what it actually is rather than a
	// useless "Other" — he should recognise his own screen.
	if key == AppOther {
		a.curApp = trimExe(proc)
	} else {
		a.curApp = friendly[key]
	}
	a.procOfKey[key] = proc
	a.note = ""
}

func keyFor(proc string) AppKey {
	if k, ok := processMap[lower(proc)]; ok {
		return k
	}
	return AppOther
}

// trimExe turns "msedge.exe" into "Msedge" — recognisable, not a filename.
func trimExe(p string) string {
	if p == "" {
		return "Other"
	}
	s := p
	if n := len(s); n > 4 && lower(s[n-4:]) == ".exe" {
		s = s[:n-4]
	}
	if s == "" {
		return "Other"
	}
	b := []byte(s)
	if b[0] >= 'a' && b[0] <= 'z' {
		b[0] -= 32
	}
	return string(b)
}

func lower(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 32
		}
	}
	return string(b)
}

// Snapshot returns the current activity view.
func (a *Agent) Snapshot() Activity {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := Activity{
		Supported: a.supported, Watching: a.watching,
		ActiveKey: a.curKey, ActiveApp: a.curApp, ActiveTitle: a.curTitle,
		Note: a.note,
	}
	if !a.curSince.IsZero() {
		out.ActiveSince = a.curSince.UTC().Format(time.RFC3339)
	}
	for k, ms := range a.millis {
		name := friendly[k]
		if k == AppOther {
			name = trimExe(a.procOfKey[k])
		}
		if name == "" {
			name = k
		}
		out.Today = append(out.Today, AppUse{Key: k, Name: name, Process: a.procOfKey[k], Seconds: int(ms / 1000)})
	}
	sort.Slice(out.Today, func(i, j int) bool { return out.Today[i].Seconds > out.Today[j].Seconds })
	return out
}
