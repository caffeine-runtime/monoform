//go:build windows

package app

import (
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/caffeine-runtime/monoform/internal/setup"
)

// installedBySetup: this copy is the one the setup program installed (it
// updates through the setup, which keeps the registry and shortcuts right).
func installedBySetup(exe string) bool {
	in, ok := setup.Find(setup.Windows{})
	return ok && strings.EqualFold(filepath.Clean(in.Dir), filepath.Dir(exe))
}

// detach starts cmd outside this process's job and console.
func detach(cmd *exec.Cmd) {
	const detached = 0x00000008 // DETACHED_PROCESS
	const newGroup = 0x00000200 // CREATE_NEW_PROCESS_GROUP
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detached | newGroup}
}
