package agent

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// A shared PowerShell bridge for the COM-backed integrations (calendar, mail
// drafting, Office read/generate). Same discipline as the mailbox reader:
//
//   - embedded script written to a private temp file, then removed
//   - -NoProfile -NonInteractive, no elevation, no window
//   - a hard timeout so a stray COM dialog can never hang the twin
//   - failure is a value, never a panic; callers report it honestly
//
// Windows-only. On any other OS the caller gets errUnsupportedOS so it can say
// "run this on his laptop" instead of pretending.

var errUnsupportedOS = errors.New("unsupported_os")

// runPowerShell writes script to a temp .ps1 and runs it, returning BOM-trimmed
// stdout. If the process exits non-zero it still returns whatever it printed
// (our scripts print a JSON error object even on failure) alongside the error.
func runPowerShell(script string, timeout time.Duration, args ...string) ([]byte, error) {
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
	out, err := cmd.Output()
	if err != nil {
		if len(out) > 0 {
			return trimBOM(out), err
		}
		return nil, err
	}
	return trimBOM(out), nil
}
