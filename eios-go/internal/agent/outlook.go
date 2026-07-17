package agent

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"time"
)

//go:embed read_outlook.ps1
var readOutlookScript string

// Message is one real mail from his mailbox.
type Message struct {
	ID      string `json:"id"`
	From    string `json:"from"`
	Address string `json:"address"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	Date    string `json:"date"`
	Unread  bool   `json:"unread"`
	Body    string `json:"body"`
}

// Meeting is one of today's calendar entries.
type Meeting struct {
	Subject   string `json:"subject"`
	Start     string `json:"start"`
	Duration  int    `json:"duration"`
	Organizer string `json:"organizer"`
}

// Mailbox is the result of one local read. Available=false is a first-class,
// honest outcome (Outlook not installed / not signed in) — never faked.
type Mailbox struct {
	Available bool      `json:"available"`
	Error     string    `json:"error,omitempty"`
	Total     int       `json:"total"`
	Unread    int       `json:"unread"`
	Messages  []Message `json:"messages"`
	Meetings  []Meeting `json:"meetings"`
	ReadAt    string    `json:"readAt"`
}

// ReadMailbox runs the embedded PowerShell bridge and parses its JSON.
// It is read-only and needs no elevation.
func ReadMailbox(limit int) Mailbox {
	if runtime.GOOS != "windows" {
		return Mailbox{Available: false, Error: "Outlook COM is Windows-only; run the agent on his laptop."}
	}
	dir, err := os.MkdirTemp("", "eios-agent")
	if err != nil {
		return Mailbox{Available: false, Error: err.Error()}
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "read_outlook.ps1")
	if err := os.WriteFile(path, []byte(readOutlookScript), 0o600); err != nil {
		return Mailbox{Available: false, Error: err.Error()}
	}

	// Outlook COM can hang if a dialog is open; never block the twin forever.
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-File", path, "-Limit", strconv.Itoa(limit))
	out, err := cmd.Output()
	if err != nil {
		msg := err.Error()
		if len(out) > 0 {
			msg = string(out)
		}
		return Mailbox{Available: false, Error: "could not read Outlook: " + msg}
	}
	var mb Mailbox
	if err := json.Unmarshal(trimBOM(out), &mb); err != nil {
		return Mailbox{Available: false, Error: fmt.Sprintf("unexpected Outlook output: %v", err)}
	}
	mb.ReadAt = time.Now().UTC().Format(time.RFC3339)
	return mb
}

// trimBOM strips a UTF-8/UTF-16 BOM PowerShell may prepend.
func trimBOM(b []byte) []byte {
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return b[3:]
	}
	return b
}
