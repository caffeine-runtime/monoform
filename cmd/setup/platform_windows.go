package main

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"

	"github.com/caffeine-runtime/hold-it-all/internal/setup"
)

func system() setup.System { return setup.Windows{} }

// startRaw starts a program with this exact command line, hidden, without waiting.
func startRaw(exe, cmdline string) error {
	cmd := exec.Command(exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW, CmdLine: cmdline}
	return cmd.Start()
}
