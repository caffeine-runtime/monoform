//go:build windows

package cli

import (
	"os"
	"syscall"
)

// AttachConsole connects a GUI-subsystem program to the console it was
// started from, so `monoform.exe hash …` prints there. (monoform-cli.exe is a
// console program and doesn't need this.) Output already redirected to a file
// or a pipe stays there.
func AttachConsole() {
	out, errs := redirected(syscall.STD_OUTPUT_HANDLE), redirected(syscall.STD_ERROR_HANDLE)
	if out && errs {
		return
	}
	k := syscall.NewLazyDLL("kernel32.dll")
	if r, _, _ := k.NewProc("AttachConsole").Call(uintptr(^uint32(0))); r == 0 { // ATTACH_PARENT_PROCESS
		return
	}
	f, err := os.OpenFile("CONOUT$", os.O_RDWR, 0)
	if err != nil {
		return
	}
	if !out {
		os.Stdout = f
	}
	if !errs {
		os.Stderr = f
	}
}

// redirected: the process was given this standard handle (a GUI program
// started from a console gets none unless its output is redirected).
func redirected(std int) bool {
	h, err := syscall.GetStdHandle(std)
	return err == nil && h != 0 && h != syscall.InvalidHandle
}
