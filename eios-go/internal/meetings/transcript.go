package meetings

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Transcript intake. Two real-world formats:
//
//   - WebVTT (.vtt) — what Teams writes to OneDrive when live transcription is
//     on. Cue text lines look like "<v Sourabh Tomar>we agreed to hold</v>".
//   - Plain lines — "Name: what they said", the format of pasted notes.
//
// ParseTranscript sniffs which one it has. It never errors on messy input; it
// extracts what it can and skips the rest.

// ParseTranscript turns raw text into utterances.
func ParseTranscript(raw string) []Utterance {
	if strings.Contains(raw, "WEBVTT") || strings.Contains(raw, "<v ") {
		return parseVTT(raw)
	}
	return parsePlain(raw)
}

func parseVTT(raw string) []Utterance {
	var out []Utterance
	var stamp string
	for _, ln := range strings.Split(raw, "\n") {
		ln = strings.TrimSpace(strings.TrimSuffix(ln, "\r"))
		if ln == "" || ln == "WEBVTT" || strings.HasPrefix(ln, "NOTE") {
			continue
		}
		if strings.Contains(ln, "-->") {
			if i := strings.Index(ln, " -->"); i > 0 {
				stamp = ln[:i]
			}
			continue
		}
		// "<v Speaker Name>text</v>" (speaker may repeat across cues)
		if strings.HasPrefix(ln, "<v ") {
			rest := ln[3:]
			if i := strings.Index(rest, ">"); i > 0 {
				speaker := rest[:i]
				text := strings.TrimSuffix(rest[i+1:], "</v>")
				if strings.TrimSpace(text) != "" {
					out = append(out, Utterance{Speaker: speaker, Text: strings.TrimSpace(text), At: stamp})
				}
			}
			continue
		}
		// cue text without a voice tag — attribute to the previous speaker
		if len(out) > 0 && !isCueID(ln) {
			out[len(out)-1].Text += " " + ln
		}
	}
	return out
}

// isCueID: bare numbers or UUID-ish lines between cues.
func isCueID(s string) bool {
	if len(s) > 40 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && r != '-' && !(r >= 'a' && r <= 'f') && !(r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

func parsePlain(raw string) []Utterance {
	var out []Utterance
	for _, ln := range strings.Split(raw, "\n") {
		ln = strings.TrimSpace(strings.TrimSuffix(ln, "\r"))
		if ln == "" {
			continue
		}
		if i := strings.Index(ln, ":"); i > 0 && i < 40 && !strings.Contains(ln[:i], " -") {
			out = append(out, Utterance{Speaker: strings.TrimSpace(ln[:i]), Text: strings.TrimSpace(ln[i+1:])})
		} else if len(out) > 0 {
			out[len(out)-1].Text += " " + ln
		} else {
			out = append(out, Utterance{Speaker: "Unknown", Text: ln})
		}
	}
	return out
}

// TranscriptFile is a Teams transcript found on disk.
type TranscriptFile struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Modified string `json:"modified"`
	Size     int64  `json:"size"`
}

// DiscoverTranscripts finds .vtt files in his synced/download folders — where
// Teams puts live transcripts. This is the no-Graph bridge: any attendee turns
// transcription on, OneDrive syncs the file down, the twin picks it up.
func DiscoverTranscripts() []TranscriptFile {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	var roots []string
	if entries, err := os.ReadDir(home); err == nil {
		for _, e := range entries {
			if e.IsDir() && strings.HasPrefix(strings.ToLower(e.Name()), "onedrive") {
				roots = append(roots, filepath.Join(home, e.Name()))
			}
		}
	}
	roots = append(roots, filepath.Join(home, "Downloads"), filepath.Join(home, "Documents"))

	var found []TranscriptFile
	for _, root := range roots {
		if _, err := os.Stat(root); err != nil {
			continue
		}
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if strings.Count(p[len(root):], string(os.PathSeparator)) > 4 ||
					strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules" {
					if p != root {
						return filepath.SkipDir
					}
				}
				return nil
			}
			if strings.ToLower(filepath.Ext(p)) != ".vtt" {
				return nil
			}
			fi, e := d.Info()
			if e != nil {
				return nil
			}
			found = append(found, TranscriptFile{
				Name: d.Name(), Path: p, Size: fi.Size(),
				Modified: fi.ModTime().UTC().Format(time.RFC3339),
			})
			return nil
		})
	}
	sort.Slice(found, func(i, j int) bool { return found[i].Modified > found[j].Modified })
	if len(found) > 20 {
		found = found[:20]
	}
	return found
}

// IngestFile reads a transcript file into a session (creating one named after
// the file if id is empty). The filename Teams uses carries the meeting name.
func (e *Engine) IngestFile(id, path string) (*Session, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	utts := ParseTranscript(string(raw))
	if id == "" {
		name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		s := e.Create(name, "", "")
		s.Source = "transcript-file"
		id = s.ID
	}
	return e.Ingest(id, utts)
}
