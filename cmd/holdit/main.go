// holdit is Hold It All's command-line program: `holdit hash *.iso`,
// `holdit verify SHA256SUMS`, `holdit info`, `holdit convert` run here (a
// console program, so output and exit codes work in every shell); `holdit
// FILE…`, `--peek` and `--preview` hand the files to the app next to it.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/caffeine-runtime/hold-it-all/internal/cli"
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
		fmt.Fprintf(os.Stderr, "holdit: the Hold It All app wasn't found next to holdit (%s)\n", app)
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
		fmt.Fprintf(os.Stderr, "holdit: %v\n", err)
		os.Exit(2)
	}
	_ = cmd.Process.Release()
}
