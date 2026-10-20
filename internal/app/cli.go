package app

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/caffeine-runtime/hold-it-all/internal/cli"
)

// CommandLine says whether the holdit command is set up.
type CommandLine struct {
	Installed bool   `json:"installed"` // holdit is on the PATH
	Path      string `json:"path"`      // where it is (or where it would go)
	Bundled   bool   `json:"bundled"`   // holdit ships next to the app
}

func holditName() string {
	if runtime.GOOS == "windows" {
		return "holdit.exe"
	}
	return "holdit"
}

// CommandLineStatus reports whether `holdit` can be run from a terminal.
func (a *App) CommandLineStatus() CommandLine {
	bundled := filepath.Join(cli.ExeDir(), holditName())
	_, err := os.Stat(bundled)
	st := CommandLine{Bundled: err == nil, Path: bundled}
	if p, err := exec.LookPath("holdit"); err == nil {
		st.Installed, st.Path = true, p
	}
	return st
}

// InstallCommandLine links holdit into a folder on the PATH: /usr/local/bin
// on macOS, ~/.local/bin on Linux. On Windows the installer adds it to PATH.
func (a *App) InstallCommandLine() (string, error) {
	src := filepath.Join(cli.ExeDir(), holditName())
	if _, err := os.Stat(src); err != nil {
		return "", errors.New("this build doesn't include the holdit program")
	}
	var dir string
	switch runtime.GOOS {
	case "darwin":
		dir = "/usr/local/bin"
	case "windows":
		return "", fmt.Errorf("the installer puts holdit on the PATH; for the portable version add %s to PATH", filepath.Dir(src))
	default:
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".local", "bin")
		os.MkdirAll(dir, 0o755)
	}
	dst := filepath.Join(dir, "holdit")
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
