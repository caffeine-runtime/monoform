//go:build windows

package cli

import (
	"os"
	"syscall"
)

// AttachConsole connects a GUI-subsystem program to the console it was
// started from, so `hold-it-all.exe hash …` prints there. (holdit.exe is a
// console program and doesn't need this.)
func AttachConsole() {
	k := syscall.NewLazyDLL("kernel32.dll")
	if r, _, _ := k.NewProc("AttachConsole").Call(uintptr(^uint32(0))); r == 0 { // ATTACH_PARENT_PROCESS
		return
	}
	if f, err := os.OpenFile("CONOUT$", os.O_RDWR, 0); err == nil {
		os.Stdout = f
		os.Stderr = f
	}
}
