package app

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Working copies (e.g. a PDF after page operations, before it is saved) live
// in a per-run temp directory that is removed on exit. Directories left by a
// crashed run are cleaned up after a day.
var (
	tempOnce sync.Once
	tempDir  string
	tempSeq  int
	tempMu   sync.Mutex
)

func appTempDir() string {
	tempOnce.Do(func() {
		base := os.TempDir()
		if des, err := os.ReadDir(base); err == nil {
			for _, d := range des {
				if !d.IsDir() || !strings.HasPrefix(d.Name(), "monoform-") {
					continue
				}
				if info, err := d.Info(); err == nil && time.Since(info.ModTime()) > 24*time.Hour {
					os.RemoveAll(filepath.Join(base, d.Name()))
				}
			}
		}
		dir, err := os.MkdirTemp(base, "monoform-")
		if err != nil {
			dir = base
		}
		tempDir = dir
	})
	return tempDir
}

// TempPath returns a fresh path (not created) in the app's temp dir.
func (a *App) TempPath(name string) string {
	tempMu.Lock()
	tempSeq++
	n := tempSeq
	tempMu.Unlock()
	return filepath.Join(appTempDir(), strconvItoa(n)+"-"+filepath.Base(name))
}

// RemoveTemp deletes a file previously returned by TempPath.
func (a *App) RemoveTemp(p string) {
	if filepath.Dir(p) == appTempDir() {
		os.Remove(p)
	}
}

func cleanupTemp() {
	if tempDir != "" && tempDir != os.TempDir() {
		os.RemoveAll(tempDir)
	}
}

func strconvItoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
