package agent

import "time"

// Teams — local, honest edition.
//
// There is no local API on a locked laptop that returns true Teams presence or
// full chat history without Microsoft Graph. So this DERIVES what it safely can
// from signals already on the machine, and says plainly that it is derived:
//
//   running  — is the Teams client actually open? (activity watcher)
//   inMeeting— is a Teams-flagged calendar event happening right now?
//   presence — inferred from those two, never claimed as the real status dot
//   meetings — today's Teams-origin meetings, straight from his Outlook calendar
//
// The moment Graph is approved, this same shape can be filled with the real
// presence/chat feed — callers won't change.

// TeamsPresence is the derived status, with its own honesty built in.
type TeamsPresence struct {
	Running    bool          `json:"running"`
	InMeeting  bool          `json:"inMeeting"`
	Status     string        `json:"status"`     // Available | Busy | In a meeting | Away | Offline
	Derived    bool          `json:"derived"`    // always true here — never the real dot
	Basis      string        `json:"basis"`      // what the inference rests on
	Current    *TeamsMeeting `json:"current"`    // the meeting he's in right now, if any
	Meetings   []TeamsMeeting `json:"meetings"`  // today's Teams meetings
	Note       string        `json:"note"`
	ReadAt     string        `json:"readAt"`
}

// TeamsMeeting is a Teams-origin calendar entry.
type TeamsMeeting struct {
	Subject   string `json:"subject"`
	Start     string `json:"start"`
	End       string `json:"end"`
	Organizer string `json:"organizer"`
	Live      bool   `json:"live"` // happening now
}

// ReadTeams composes the local Teams picture from the activity watcher and the
// Outlook calendar. Never fabricates a presence it cannot justify.
func ReadTeams(a *Agent) TeamsPresence {
	now := time.Now()
	tp := TeamsPresence{
		Derived: true,
		Status:  "Offline",
		ReadAt:  now.UTC().Format(time.RFC3339),
		Note:    "Presence is inferred from the running client and today's calendar — real Teams presence/chats need Microsoft Graph (admin consent).",
	}

	// Running? Look at what the activity watcher has seen today + right now.
	snap := a.Snapshot()
	if snap.ActiveKey == AppTeams {
		tp.Running = true
	}
	for _, u := range snap.Today {
		if u.Key == AppTeams && u.Seconds > 0 {
			tp.Running = true
		}
	}

	// Today's Teams meetings, from the calendar (best local source of titles).
	day := ReadDay(1)
	if day.Available {
		for _, ev := range day.Events {
			if !ev.IsTeams {
				continue
			}
			m := TeamsMeeting{Subject: ev.Subject, Start: ev.Start, End: ev.End, Organizer: ev.Organizer}
			if s, err := time.Parse(time.RFC3339, ev.Start); err == nil {
				if e, err2 := time.Parse(time.RFC3339, ev.End); err2 == nil {
					if !now.Before(s.Local()) && now.Before(e.Local()) {
						m.Live = true
						tp.InMeeting = true
						cur := m
						tp.Current = &cur
					}
				}
			}
			tp.Meetings = append(tp.Meetings, m)
		}
	} else if day.Reason != "" {
		tp.Note = "Teams meeting titles come from Outlook, which isn't readable here (" + day.Reason + "). " + tp.Note
	}

	// Infer the status honestly.
	switch {
	case tp.InMeeting:
		tp.Status = "In a meeting"
		tp.Basis = "a Teams meeting is on the calendar right now"
	case snap.ActiveKey == AppTeams:
		tp.Status = "Available"
		tp.Basis = "Teams is the app in front of him"
	case tp.Running:
		tp.Status = "Away"
		tp.Basis = "Teams is running but not focused"
	default:
		tp.Status = "Offline"
		tp.Basis = "the Teams client isn't running"
	}

	if tp.Meetings == nil {
		tp.Meetings = []TeamsMeeting{}
	}
	return tp
}
