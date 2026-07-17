//go:build windows

package agent

import (
	"errors"
	"path/filepath"
	"syscall"
	"unsafe"
)

// Foreground-window detection via user32/kernel32. Pure stdlib syscalls — no
// cgo, no third-party packages, no elevation. This is read-only observation of
// the desktop the executive is already looking at.

var (
	user32                       = syscall.NewLazyDLL("user32.dll")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetWindowTextW           = user32.NewProc("GetWindowTextW")
	procGetWindowThreadProcessID = user32.NewProc("GetWindowThreadProcessId")

	kernel32                       = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess                = kernel32.NewProc("OpenProcess")
	procCloseHandle                = kernel32.NewProc("CloseHandle")
	procQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
)

const processQueryLimitedInformation = 0x1000

func activitySupported() bool {
	return procGetForegroundWindow.Find() == nil && procQueryFullProcessImageNameW.Find() == nil
}

// foregroundApp returns the image name (e.g. "OUTLOOK.EXE") and window title of
// whatever the executive currently has in front of him.
func foregroundApp() (string, string, error) {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return "", "", errors.New("no foreground window")
	}

	// window title
	buf := make([]uint16, 512)
	n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	title := ""
	if n > 0 {
		title = syscall.UTF16ToString(buf[:n])
	}

	// owning process id
	var pid uint32
	procGetWindowThreadProcessID.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return "", title, errors.New("no pid for window")
	}

	h, _, _ := procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if h == 0 {
		return "", title, errors.New("cannot open process")
	}
	defer procCloseHandle.Call(h)

	pbuf := make([]uint16, syscall.MAX_PATH)
	size := uint32(len(pbuf))
	r, _, _ := procQueryFullProcessImageNameW.Call(h, 0, uintptr(unsafe.Pointer(&pbuf[0])), uintptr(unsafe.Pointer(&size)))
	if r == 0 {
		return "", title, errors.New("cannot read process image name")
	}
	full := syscall.UTF16ToString(pbuf[:size])
	return filepath.Base(full), title, nil
}
