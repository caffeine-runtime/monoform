//go:build !windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"

	"github.com/caffeine-runtime/hold-it-all/internal/setup"
)

// Off Windows there is only the demo (see main's --demo).
func system() setup.System {
	return setup.NewRecord(filepath.Join(os.TempDir(), "hold-it-all-setup-demo"))
}

func hide(*exec.Cmd) {}
