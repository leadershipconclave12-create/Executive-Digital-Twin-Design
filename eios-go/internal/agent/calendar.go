package agent

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

//go:embed read_calendar.ps1
var readCalendarScript string

// CalEvent is one entry on his day, as read from Outlook.
type CalEvent struct {
	Subject   string `json:"subject"`
	Start     string `json:"start"` // RFC3339
	End       string `json:"end"`
	Duration  int    `json:"duration"` // minutes
	Organizer string `json:"organizer"`
	Location  string `json:"location"`
	Busy      int    `json:"busy"` // 0 free 1 tentative 2 busy 3 oof 4 elsewhere
	BusyLabel string `json:"busyLabel"`
	AllDay    bool   `json:"allDay"`
	IsTeams   bool   `json:"isTeams"`
}

// FreeBlock is an uncommitted stretch of the working day.
type FreeBlock struct {
	Start   string `json:"start"`
	End     string `json:"end"`
	Minutes int    `json:"minutes"`
}

// Conflict is two events that overlap — something has to give.
type Conflict struct {
	A       string `json:"a"`
	B       string `json:"b"`
	Overlap int    `json:"overlapMinutes"`
}

// Day is the composed view: the raw events plus what the twin worked out.
type Day struct {
	Available     bool        `json:"available"`
	Reason        string      `json:"reason,omitempty"`
	Error         string      `json:"error,omitempty"`
	Fix           string      `json:"fix,omitempty"`
	Date          string      `json:"date"`
	Events        []CalEvent  `json:"events"`
	MeetingCount  int         `json:"meetingCount"`
	BookedMinutes int         `json:"bookedMinutes"`
	FreeBlocks    []FreeBlock `json:"freeBlocks"`
	Conflicts     []Conflict  `json:"conflicts"`
	FocusProposal *FreeBlock  `json:"focusProposal"`
	Headline      string      `json:"headline"`
	ReadAt        string      `json:"readAt"`
}

var busyLabels = map[int]string{0: "free", 1: "tentative", 2: "busy", 3: "out of office", 4: "elsewhere"}

// workday is the window inside which we look for focus time (local clock).
const workdayStart, workdayEnd = 9, 18

// ReadDay reads the calendar and composes the day. days=1 is today only.
func ReadDay(days int) Day {
	if days < 1 {
		days = 1
	}
	out, err := runPowerShell(readCalendarScript, 45*time.Second, "-Days", fmt.Sprint(days))
	if err == errUnsupportedOS {
		return Day{Available: false, Reason: "unsupported_os",
			Error: "Outlook COM is Windows-only; run the agent on his laptop."}
	}
	if err != nil && len(out) == 0 {
		return Day{Available: false, Error: "could not read the calendar: " + err.Error()}
	}
	var raw struct {
		Available bool       `json:"available"`
		Reason    string     `json:"reason"`
		Error     string     `json:"error"`
		Fix       string     `json:"fix"`
		Events    []CalEvent `json:"events"`
	}
	if e := json.Unmarshal(out, &raw); e != nil {
		return Day{Available: false, Error: "unexpected calendar output: " + e.Error()}
	}
	if !raw.Available {
		return Day{Available: false, Reason: raw.Reason, Error: raw.Error, Fix: raw.Fix}
	}
	return composeDay(raw.Events, time.Now())
}

// composeDay is pure: given events and "now", it works out the free blocks,
// conflicts and the best focus slot. Kept separate so it can be tested without
// Outlook or Windows.
func composeDay(events []CalEvent, now time.Time) Day {
	for i := range events {
		events[i].BusyLabel = busyLabels[events[i].Busy]
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].Start < events[j].Start })

	day := Day{
		Available: true,
		Date:      now.Format("Mon, 02 Jan 2006"),
		Events:    events,
		ReadAt:    now.UTC().Format(time.RFC3339),
	}

	// Only committed time (busy / tentative / oof) blocks focus; "free" markers
	// and all-day banners don't consume the day.
	type span struct {
		s, e  time.Time
		title string
	}
	var busy []span
	for _, ev := range events {
		if ev.AllDay || ev.Busy == 0 {
			continue
		}
		s, err1 := time.Parse(time.RFC3339, ev.Start)
		e, err2 := time.Parse(time.RFC3339, ev.End)
		if err1 != nil || err2 != nil || !e.After(s) {
			continue
		}
		busy = append(busy, span{s.Local(), e.Local(), ev.Subject})
		day.BookedMinutes += int(e.Sub(s).Minutes())
		day.MeetingCount++
	}
	sort.Slice(busy, func(i, j int) bool { return busy[i].s.Before(busy[j].s) })

	// Conflicts: any pair that overlaps.
	for i := 0; i < len(busy); i++ {
		for j := i + 1; j < len(busy); j++ {
			if busy[j].s.Before(busy[i].e) {
				ov := int(minTime(busy[i].e, busy[j].e).Sub(busy[j].s).Minutes())
				if ov > 0 {
					day.Conflicts = append(day.Conflicts, Conflict{A: busy[i].title, B: busy[j].title, Overlap: ov})
				}
			}
		}
	}

	// Free blocks inside the workday, merging overlaps as we sweep.
	loc := now.Location()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), workdayStart, 0, 0, 0, loc)
	dayEnd := time.Date(now.Year(), now.Month(), now.Day(), workdayEnd, 0, 0, 0, loc)
	cursor := dayStart
	if now.After(cursor) {
		cursor = now // no focus block in the past
	}
	for _, b := range busy {
		if b.e.Before(cursor) {
			continue
		}
		if b.s.After(cursor) {
			addFree(&day, cursor, minTime(b.s, dayEnd))
		}
		if b.e.After(cursor) {
			cursor = b.e
		}
		if !cursor.Before(dayEnd) {
			break
		}
	}
	if cursor.Before(dayEnd) {
		addFree(&day, cursor, dayEnd)
	}

	// Focus proposal: the longest free block of at least 45 minutes.
	for i := range day.FreeBlocks {
		if day.FreeBlocks[i].Minutes >= 45 {
			if day.FocusProposal == nil || day.FreeBlocks[i].Minutes > day.FocusProposal.Minutes {
				fb := day.FreeBlocks[i]
				day.FocusProposal = &fb
			}
		}
	}

	day.Headline = dayHeadline(day)
	return day
}

func addFree(d *Day, s, e time.Time) {
	m := int(e.Sub(s).Minutes())
	if m < 15 { // ignore gaps too short to matter
		return
	}
	d.FreeBlocks = append(d.FreeBlocks, FreeBlock{
		Start: s.Format("15:04"), End: e.Format("15:04"), Minutes: m,
	})
}

func dayHeadline(d Day) string {
	switch {
	case d.MeetingCount == 0:
		return "No meetings today — the day is yours."
	case len(d.Conflicts) > 0:
		return fmt.Sprintf("%d meeting(s), and %d clash — you'll need to pick.", d.MeetingCount, len(d.Conflicts))
	case d.FocusProposal != nil:
		return fmt.Sprintf("%d meeting(s). Best focus window: %s–%s (%dm).",
			d.MeetingCount, d.FocusProposal.Start, d.FocusProposal.End, d.FocusProposal.Minutes)
	default:
		return fmt.Sprintf("%d meeting(s) — back-to-back, no long gap for deep work.", d.MeetingCount)
	}
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
