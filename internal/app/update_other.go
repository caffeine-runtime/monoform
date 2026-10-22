//go:build !windows

package app

import (
	"os/exec"
	"syscall"
)

// installedBySetup: only Windows has the setup program.
func installedBySetup(string) bool { return false }

// detach starts cmd in its own session, so it outlives this process.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
