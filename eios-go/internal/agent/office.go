package agent

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

//go:embed read_office.ps1
var readOfficeScript string

//go:embed write_report.ps1
var writeReportScript string

// OfficeDoc is the extracted content of one Word/Excel/PowerPoint file.
type OfficeDoc struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
	Error     string `json:"error,omitempty"`
	Fix       string `json:"fix,omitempty"`
	Kind      string `json:"kind,omitempty"` // word | excel | powerpoint
	Title     string `json:"title,omitempty"`
	// Word
	Text       string `json:"text,omitempty"`
	Paragraphs int    `json:"paragraphs,omitempty"`
	Words      int    `json:"words,omitempty"`
	// Excel
	Sheets []OfficeSheet `json:"sheets,omitempty"`
	// PowerPoint
	Slides []OfficeSlide `json:"slides,omitempty"`
	ReadAt string        `json:"readAt,omitempty"`
}

type OfficeSheet struct {
	Name    string     `json:"name"`
	Rows    int        `json:"rows"`
	Cols    int        `json:"cols"`
	Preview [][]string `json:"preview"`
}

type OfficeSlide struct {
	Index int    `json:"index"`
	Text  string `json:"text"`
}

// ReadOfficeDoc extracts text from an Office file, read-only (the file is opened
// read-only and closed without saving).
func ReadOfficeDoc(path string) OfficeDoc {
	out, err := runPowerShell(readOfficeScript, 60*time.Second, "-Path", path)
	if err == errUnsupportedOS {
		return OfficeDoc{Available: false, Reason: "unsupported_os",
			Error: "Office COM is Windows-only; run the agent on his laptop."}
	}
	if err != nil && len(out) == 0 {
		return OfficeDoc{Available: false, Error: "could not read the document: " + err.Error()}
	}
	var doc OfficeDoc
	if e := json.Unmarshal(out, &doc); e != nil {
		return OfficeDoc{Available: false, Error: "unexpected document output: " + e.Error()}
	}
	if doc.Available {
		doc.ReadAt = time.Now().UTC().Format(time.RFC3339)
	}
	return doc
}

// ReportSection is one heading + body of a generated report.
type ReportSection struct {
	Heading string `json:"heading"`
	Body    string `json:"body"`
}

// ReportResult is where the generated .docx landed.
type ReportResult struct {
	Created  bool   `json:"created"`
	Reason   string `json:"reason,omitempty"`
	Error    string `json:"error,omitempty"`
	Fix      string `json:"fix,omitempty"`
	Path     string `json:"path,omitempty"`
	Title    string `json:"title,omitempty"`
	Sections int    `json:"sections,omitempty"`
	At       string `json:"at,omitempty"`
}

// GenerateReport builds a Word .docx from a title + sections and saves it into
// his Documents folder. This writes a NEW file only; it never edits his files.
func GenerateReport(title string, sections []ReportSection) ReportResult {
	if runtime.GOOS != "windows" {
		return ReportResult{Created: false, Reason: "unsupported_os",
			Error: "Word COM is Windows-only; run the agent on his laptop."}
	}
	payload, _ := json.Marshal(sections)
	out, err := runPowerShellStdin(writeReportScript, payload, 60*time.Second, "-Title", title)
	if err != nil && len(out) == 0 {
		return ReportResult{Created: false, Error: "could not generate the report: " + err.Error()}
	}
	var res ReportResult
	if e := json.Unmarshal(out, &res); e != nil {
		return ReportResult{Created: false, Error: "unexpected report output: " + e.Error()}
	}
	if res.Created {
		res.At = time.Now().UTC().Format(time.RFC3339)
	}
	return res
}

// runPowerShellStdin is runPowerShell with a payload piped to the script's stdin
// — used so report content of any size/shape avoids command-line quoting.
func runPowerShellStdin(script string, stdin []byte, timeout time.Duration, args ...string) ([]byte, error) {
	if runtime.GOOS != "windows" {
		return nil, errUnsupportedOS
	}
	dir, err := os.MkdirTemp("", "eios-agent")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "script.ps1")
	if err := os.WriteFile(path, []byte(script), 0o600); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	full := append([]string{
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path,
	}, args...)
	cmd := exec.CommandContext(ctx, "powershell.exe", full...)
	cmd.Stdin = bytes.NewReader(stdin)
	out, err := cmd.Output()
	if err != nil {
		if len(out) > 0 {
			return trimBOM(out), err
		}
		return nil, err
	}
	return trimBOM(out), nil
}
