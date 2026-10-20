package app

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/caffeine-runtime/hold-it-all/internal/fs"
	"github.com/caffeine-runtime/hold-it-all/internal/history"
	"github.com/caffeine-runtime/hold-it-all/internal/settings"
)

// openHistory starts file history next to the settings file. The app's own
// folders (settings, caches, working copies) are never versioned.
func (a *App) openHistory(settingsPath string) {
	dir := filepath.Dir(settingsPath)
	h, err := history.Open(filepath.Join(dir, "history"), dir, cacheDir())
	if err != nil {
		log.Printf("history: %v", err)
		return
	}
	// Working copies (appTempDir, made on first use) are named hold-it-all-*.
	tmp := []string{os.TempDir()}
	if r, err := filepath.EvalSymlinks(tmp[0]); err == nil && r != tmp[0] {
		tmp = append(tmp, r)
	}
	h.Skip = func(abs string) bool {
		for _, t := range tmp {
			if rel, err := filepath.Rel(t, abs); err == nil && strings.HasPrefix(rel, "hold-it-all-") {
				return true
			}
		}
		return false
	}
	a.History = h
	a.configureHistory(a.Settings.Get())
	fs.SetVersioner(h)
}

func (a *App) configureHistory(s settings.Settings) {
	if a.History == nil {
		return
	}
	l := history.Limits{MaxPerFile: s.HistoryKeep}
	if s.HistoryMaxMB > 0 {
		l.MaxTotal = int64(s.HistoryMaxMB) << 20
	}
	a.History.Configure(!s.HistoryOff, l)
}

// errNoHistory is returned when the history folder couldn't be opened.
var errNoHistory = fmt.Errorf("file history is not available")

// HistoryOf lists the kept versions of a file, newest first.
func (a *App) HistoryOf(path string) (history.File, error) {
	if a.History == nil {
		return history.File{}, errNoHistory
	}
	return a.History.History(path), nil
}

// HistoryFiles lists every file with kept versions, including deleted ones.
func (a *App) HistoryFiles() ([]history.Summary, error) {
	if a.History == nil {
		return nil, errNoHistory
	}
	return a.History.Files(), nil
}

// HistoryExtract writes a kept version to a working copy (for viewing or
// comparing) named after the file and the time of the version.
func (a *App) HistoryExtract(path, hash string, at int64) (string, error) {
	if a.History == nil {
		return "", errNoHistory
	}
	rc, err := a.History.OpenVersion(hash)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	dir, err := os.MkdirTemp(appTempDir(), "version-")
	if err != nil {
		return "", err
	}
	base := filepath.Base(path)
	ext := filepath.Ext(base)
	name := fmt.Sprintf("%s (%s)%s", strings.TrimSuffix(base, ext), time.UnixMilli(at).Format("2006-01-02 15.04.05"), ext)
	dst := filepath.Join(dir, name)
	if err := fs.AtomicWriteReader(dst, rc); err != nil {
		return "", err
	}
	return dst, nil
}

// HistoryRestore puts a kept version back (the current content is kept as a
// version first, so a restore can itself be undone).
func (a *App) HistoryRestore(path, hash string) error {
	if a.History == nil {
		return errNoHistory
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(path) // the open tab is reloaded by the caller
	}
	return a.History.Restore(path, hash, fs.AtomicWriteReader)
}

// HistoryForget drops the kept versions of a file ("" for all files).
func (a *App) HistoryForget(path string) error {
	if a.History == nil {
		return errNoHistory
	}
	a.History.Forget(path)
	return nil
}

// HistoryUsage is the disk space the kept versions take.
func (a *App) HistoryUsage() int64 {
	if a.History == nil {
		return 0
	}
	return a.History.Usage()
}
