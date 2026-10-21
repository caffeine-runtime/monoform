package app

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

var revealed struct {
	sync.Mutex
	last string
}

// ShowInFolder opens the system file manager at p (a folder), or at the
// folder holding p with p selected (a file) where the system supports it.
// In self-test mode nothing is started; TestLastShown reports the path.
func (a *App) ShowInFolder(p string) error {
	abs, err := filepath.Abs(p)
	if err != nil {
		return err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return errors.New("not found: " + p)
	}
	if os.Getenv("HIA_TEST") != "" {
		revealed.Lock()
		revealed.last = abs
		revealed.Unlock()
		return nil
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = explorerCommand(abs, st.IsDir())
	case "darwin":
		if st.IsDir() {
			cmd = exec.Command("open", abs)
		} else {
			cmd = exec.Command("open", "-R", abs)
		}
	default:
		dir := abs
		if !st.IsDir() {
			dir = filepath.Dir(abs)
		}
		cmd = exec.Command("xdg-open", dir)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// TestLastShown is the path the last ShowInFolder call would have opened
// (self-test mode only).
func (a *App) TestLastShown() string {
	revealed.Lock()
	defer revealed.Unlock()
	return revealed.last
}
