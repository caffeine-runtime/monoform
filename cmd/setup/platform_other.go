//go:build !windows

package main

import (
	"os"
	"path/filepath"

	"github.com/caffeine-runtime/monoform/internal/setup"
)

// Off Windows there is only the demo (see main's --demo).
func system() setup.System {
	return setup.NewRecord(filepath.Join(os.TempDir(), "monoform-setup-demo"))
}

func startRaw(exe, cmdline string) error { return nil }
