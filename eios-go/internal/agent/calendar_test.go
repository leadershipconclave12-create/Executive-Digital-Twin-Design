package agent

import (
	"testing"
	"time"
)

// composeDay is the only piece of the local integrations with real logic that
// doesn't touch Windows — so it gets real tests.

func at(base time.Time, h, m int) string {
	return time.Date(base.Year(), base.Month(), base.Day(), h, m, 0, 0, base.Location()).Format(time.RFC3339)
}

func TestFocusBlockAndBooked(t *testing.T) {
	now := time.Date(2026, 7, 20, 8, 0, 0, 0, time.Local) // 8am, before the day starts
	events := []CalEvent{
		{Subject: "Standup", Start: at(now, 9, 30), End: at(now, 10, 0), Busy: 2},
		{Subject: "Vendor review", Start: at(now, 14, 0), End: at(now, 15, 0), Busy: 2},
	}
	day := composeDay(events, now)
	if !day.Available {
		t.Fatal("expected an available day")
	}
	if day.MeetingCount != 2 {
		t.Errorf("expected 2 meetings, got %d", day.MeetingCount)
	}
	if day.BookedMinutes != 90 {
		t.Errorf("expected 90 booked minutes, got %d", day.BookedMinutes)
	}
	// The 10:00–14:00 gap (240m) is the longest free stretch.
	if day.FocusProposal == nil {
		t.Fatal("expected a focus proposal")
	}
	if day.FocusProposal.Minutes != 240 {
		t.Errorf("expected a 240m focus block, got %d (%s–%s)",
			day.FocusProposal.Minutes, day.FocusProposal.Start, day.FocusProposal.End)
	}
	if day.FocusProposal.Start != "10:00" {
		t.Errorf("expected focus to start at 10:00, got %s", day.FocusProposal.Start)
	}
}

func TestConflictDetected(t *testing.T) {
	now := time.Date(2026, 7, 20, 8, 0, 0, 0, time.Local)
	events := []CalEvent{
		{Subject: "Board call", Start: at(now, 11, 0), End: at(now, 12, 0), Busy: 2},
		{Subject: "1:1 with VP", Start: at(now, 11, 30), End: at(now, 12, 30), Busy: 2},
	}
	day := composeDay(events, now)
	if len(day.Conflicts) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(day.Conflicts))
	}
	if day.Conflicts[0].Overlap != 30 {
		t.Errorf("expected a 30m overlap, got %d", day.Conflicts[0].Overlap)
	}
}

func TestFreeMarkersDoNotBook(t *testing.T) {
	now := time.Date(2026, 7, 20, 8, 0, 0, 0, time.Local)
	events := []CalEvent{
		{Subject: "Focus (marked free)", Start: at(now, 10, 0), End: at(now, 12, 0), Busy: 0},
		{Subject: "All-day: Diwali", Start: at(now, 0, 0), End: at(now, 0, 0), Busy: 2, AllDay: true},
	}
	day := composeDay(events, now)
	if day.MeetingCount != 0 {
		t.Errorf("free markers and all-day banners must not count as meetings, got %d", day.MeetingCount)
	}
	if day.BookedMinutes != 0 {
		t.Errorf("expected 0 booked minutes, got %d", day.BookedMinutes)
	}
}

func TestNoMeetingsHeadline(t *testing.T) {
	now := time.Date(2026, 7, 20, 8, 0, 0, 0, time.Local)
	day := composeDay(nil, now)
	if day.Headline == "" || day.MeetingCount != 0 {
		t.Errorf("expected an empty-day headline, got %q / %d", day.Headline, day.MeetingCount)
	}
}
