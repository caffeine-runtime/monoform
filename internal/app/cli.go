package app

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/caffeine-runtime/monoform/internal/cli"
)

// CommandLine says whether the monoform command is set up.
type CommandLine struct {
	Installed bool   `json:"installed"` // monoform is on the PATH
	Path      string `json:"path"`      // where it is (or where it would go)
	Bundled   bool   `json:"bundled"`   // monoform ships next to the app
}

// cliProgram is what the monoform command runs: the console program next to
// the app (Windows, macOS), or on Linux the app itself, which answers
// `monoform hash …` and the other commands without opening a window.
func cliProgram() string {
	name := "monoform-cli"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	p := filepath.Join(cli.ExeDir(), name)
	if _, err := os.Stat(p); err != nil && runtime.GOOS == "linux" {
		if exe, err := os.Executable(); err == nil {
			return exe
		}
	}
	return p
}

// CommandLineStatus reports whether `monoform` can be run from a terminal.
func (a *App) CommandLineStatus() CommandLine {
	bundled := cliProgram()
	_, err := os.Stat(bundled)
	st := CommandLine{Bundled: err == nil, Path: bundled}
	if p, err := exec.LookPath("monoform"); err == nil {
		st.Installed, st.Path = true, p
	}
	return st
}

// InstallCommandLine links monoform into a folder on the PATH: /usr/local/bin
// on macOS, ~/.local/bin on Linux. On Windows the installer adds it to PATH.
func (a *App) InstallCommandLine() (string, error) {
	src := cliProgram()
	if _, err := os.Stat(src); err != nil {
		return "", errors.New("this build doesn't include the monoform program")
	}
	var dir string
	switch runtime.GOOS {
	case "darwin":
		dir = "/usr/local/bin"
	case "windows":
		return "", fmt.Errorf("the installer puts monoform on the PATH; for the portable version add %s to PATH", filepath.Dir(src))
	default:
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".local", "bin")
		os.MkdirAll(dir, 0o755)
	}
	dst := filepath.Join(dir, "monoform")
	if fi, err := os.Lstat(dst); err == nil && fi.Mode()&os.ModeSymlink != 0 {
		os.Remove(dst)
	}
	if err := os.Symlink(src, dst); err != nil {
		if runtime.GOOS == "darwin" {
			return "", fmt.Errorf("not allowed to write to %s; run in Terminal: sudo ln -sf '%s' %s", dir, src, dst)
		}
		return "", err
	}
	return dst, nil
}
