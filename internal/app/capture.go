package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/caffeine-runtime/hold-it-all/internal/capture"
)

// screenshotDir is where screenshots are saved: Pictures/Screenshots.
func screenshotDir() string {
	if d := os.Getenv("HIA_SCREENSHOTS"); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return os.TempDir()
	}
	return filepath.Join(home, "Pictures", "Screenshots")
}

// ScreenCapture takes a screenshot ("region" or "screen"), after delay
// seconds, with this window out of the way. It is saved to
// Pictures/Screenshots, or to a temp file (picking a colour from the
// screen). Path is "" when the user cancelled.
func (a *App) ScreenCapture(mode string, delay int, temp bool) (capture.Result, error) {
	name := "Screenshot " + time.Now().Format("2006-01-02 at 15.04.05") + ".png"
	dst := filepath.Join(screenshotDir(), name)
	if temp {
		dst = a.TempPath(name)
	}
	hide := a.ctx != nil && os.Getenv("HIA_TEST_KEEP_WINDOW") == ""
	if hide {
		wruntime.WindowHide(a.ctx)
		defer wruntime.WindowShow(a.ctx)
	}
	// Let the window disappear (and the user get ready).
	time.Sleep(300*time.Millisecond + time.Duration(min(max(delay, 0), 30))*time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	r, err := capture.Take(ctx, capture.Mode(mode), dst)
	if errors.Is(err, capture.ErrCancelled) {
		return capture.Result{}, nil
	}
	return r, err
}
