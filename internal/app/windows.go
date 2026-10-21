package app

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/caffeine-runtime/hold-it-all/internal/settings"
)

// A tab moved to a window of its own runs as a second app process started
// with --new-window (Wails v2 has one window per process). That process
// doesn't take the single-instance lock, doesn't restore or save the
// session, and keeps the main window's session when it saves settings.

// NewWindow starts a new window showing paths. x, y is where on the screen
// the tab was dropped (negative: let the system place it).
func (a *App) NewWindow(paths []string, x, y int) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{"--new-window"}
	if x >= 0 && y >= 0 {
		args = append(args, fmt.Sprintf("--at=%d,%d", x, y))
	}
	cmd := exec.Command(exe, append(args, paths...)...)
	cmd.Env = childEnv(os.Environ())
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait() // reap it when it exits
	return nil
}

// childEnv is the environment for a new window. A self-test run gives the
// child its own small check ("windowchild") instead of repeating the parent's.
func childEnv(env []string) []string {
	out := make([]string, 0, len(env)+1)
	test := ""
	for _, kv := range env {
		if v, ok := strings.CutPrefix(kv, "HIA_TEST="); ok {
			test = v
			continue
		}
		out = append(out, kv)
	}
	if test != "" {
		out = append(out, "HIA_TEST=windowchild")
	}
	return out
}

// SetStartPosition places the window at a screen point once it shows (the
// cursor lands on its tab bar).
func (a *App) SetStartPosition(x, y int) {
	a.startAt = &[2]int{x, y}
}

func (a *App) placeWindow() {
	if a.startAt == nil || a.ctx == nil {
		return
	}
	w, h := wruntime.WindowGetSize(a.ctx)
	sw, sh := 1<<15, 1<<15
	if screens, err := wruntime.ScreenGetAll(a.ctx); err == nil {
		for _, s := range screens {
			if s.IsCurrent || (s.IsPrimary && sw == 1<<15) {
				sw, sh = s.Size.Width, s.Size.Height
			}
		}
	}
	x, y := fitOnScreen(a.startAt[0]-160, a.startAt[1]-18, w, h, sw, sh)
	wruntime.WindowSetPosition(a.ctx, x, y)
	a.startAt = nil
}

// fitOnScreen moves a w×h window at x, y so it lies on a sw×sh screen (as
// far as it can).
func fitOnScreen(x, y, w, h, sw, sh int) (int, int) {
	return max(0, min(x, sw-w)), max(0, min(y, sh-h))
}

// keepSession returns s with the session that is on disk: a moved-out window
// must not replace the main window's tabs when it saves a setting.
func keepSession(s settings.Settings, path string) settings.Settings {
	if disk, err := settings.Open(path); err == nil {
		s.Session = disk.Get().Session
	}
	return s
}
