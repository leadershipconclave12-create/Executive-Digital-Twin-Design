//go:build !windows

package agent

import "errors"

// The executive's laptop is Windows. Everywhere else the agent compiles but
// reports honestly that it cannot observe, rather than inventing activity.

func activitySupported() bool { return false }

func foregroundApp() (string, string, error) {
	return "", "", errors.New("foreground-window watching is Windows-only")
}
