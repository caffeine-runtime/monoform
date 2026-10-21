// monoform is Monoform's command-line program: `monoform hash *.iso`,
// `monoform verify SHA256SUMS`, `monoform info`, `monoform convert` run here (a
// console program, so output and exit codes work in every shell); `monoform
// FILE…`, `--peek` and `--preview` hand the files to the app next to it.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/caffeine-runtime/monoform/internal/cli"
)

// version is set at build time (-ldflags "-X main.version=…").
var version = "dev"

func main() {
	args := os.Args[1:]
	if code, ok := cli.Main(args, version, os.Stdout, os.Stderr); ok {
		os.Exit(code)
	}
	app := cli.AppPath()
	if _, err := os.Stat(app); err != nil {
		fmt.Fprintf(os.Stderr, "monoform: the Monoform app wasn't found next to monoform (%s)\n", app)
		os.Exit(2)
	}
	// Files become absolute: the app (or a window already open) may run elsewhere.
	pass := make([]string, 0, len(args))
	for _, a := range args {
		if len(a) > 0 && a[0] != '-' {
			if abs, err := filepath.Abs(a); err == nil {
				a = abs
			}
		}
		pass = append(pass, a)
	}
	cmd := exec.Command(app, pass...)
	detach(cmd)
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "monoform: %v\n", err)
		os.Exit(2)
	}
	_ = cmd.Process.Release()
}
