package main

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"

	"github.com/caffeine-runtime/hold-it-all/internal/setup"
)

func system() setup.System { return setup.Windows{} }

func hide(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
}
