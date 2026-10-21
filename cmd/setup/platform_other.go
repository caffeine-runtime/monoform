//go:build !windows

package main

import (
	"os"
	"path/filepath"

	"github.com/caffeine-runtime/hold-it-all/internal/setup"
)

// Off Windows there is only the demo (see main's --demo).
func system() setup.System {
	return setup.NewRecord(filepath.Join(os.TempDir(), "hold-it-all-setup-demo"))
}

func startRaw(exe, cmdline string) error { return nil }
