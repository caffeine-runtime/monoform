package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/caffeine-runtime/monoform/internal/jobs"
	"github.com/caffeine-runtime/monoform/internal/update"
)

// UpdateInfo is what the update check found.
type UpdateInfo struct {
	Available bool   `json:"available"`
	Current   string `json:"current"`
	Version   string `json:"version"`
	Notes     string `json:"notes"`
	URL       string `json:"url"`
	Size      int64  `json:"size"`
	// Install says how it would be installed: "installer" (Windows setup),
	// "portable", "app" (macOS bundle), "binary" (Linux) or "manual" (this
	// copy can't replace itself: download it from the release page).
	Install string `json:"install"`
}

var (
	updateMu  sync.Mutex
	updateRel *update.Release
)

// fakeUpdates (MF_UPDATE_FAKE=1, self-tests): a made-up newer version, a
// tiny "download" and an install that only logs.
func fakeUpdates() bool { return os.Getenv("MF_UPDATE_FAKE") != "" }

// installKind says how this copy updates itself.
func installKind(exe string) string {
	switch {
	case fakeUpdates():
		return "binary"
	case update.GOOS == "windows" && installedBySetup(exe):
		return "installer"
	case update.GOOS == "windows":
		return writableKind(exe, "portable")
	case update.GOOS == "darwin":
		if b := update.BundleOf(exe); b != "" {
			return writableKind(b, "app")
		}
		return "manual"
	default:
		return writableKind(exe, "binary")
	}
}

// writableKind is kind when the folder of p can be written (a copy installed
// by a package manager into /usr can't replace itself), else "manual".
func writableKind(p, kind string) string {
	f, err := os.CreateTemp(filepath.Dir(p), ".monoform-write-test-")
	if err != nil {
		return "manual"
	}
	f.Close()
	os.Remove(f.Name())
	return kind
}

// UpdateCheck asks GitHub for the newest release (one request, nothing sent
// about this computer). Local builds (version "…-dev") are never updated.
func (a *App) UpdateCheck() (UpdateInfo, error) {
	info := UpdateInfo{Current: Version}
	exe, _ := os.Executable()
	info.Install = installKind(exe)
	var rel update.Release
	if fakeUpdates() {
		rel = update.Release{Version: "99.0.0", Notes: "## What's new\n- Something new\n- A fix", URL: "https://github.com/" + update.Repo + "/releases", Asset: "fake-update.bin", AssetURL: "fake", AssetSize: 1 << 20}
	} else {
		if update.IsDev(Version) {
			return info, nil
		}
		if v := os.Getenv("MF_UPDATE_API"); v != "" {
			update.API = v // a local stand-in for GitHub (end-to-end tests)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		var err error
		rel, err = update.Latest(ctx, update.GOOS, info.Install == "portable")
		if err != nil {
			return info, err
		}
	}
	if !update.Newer(rel.Version, Version) && !fakeUpdates() {
		return info, nil
	}
	if rel.AssetURL == "" {
		info.Install = "manual"
	}
	updateMu.Lock()
	updateRel = &rel
	updateMu.Unlock()
	info.Available, info.Version, info.Notes, info.URL, info.Size = true, rel.Version, rel.Notes, rel.URL, rel.AssetSize
	return info, nil
}

// UpdateDownload downloads the package UpdateCheck found as a job (progress,
// cancel); its result is the package's path.
func (a *App) UpdateDownload() (string, error) {
	updateMu.Lock()
	rel := updateRel
	updateMu.Unlock()
	if rel == nil {
		return "", errors.New("no update to download")
	}
	r := *rel
	dir := filepath.Join(cacheDir(), "updates")
	return a.Jobs.Start("update", "Downloading Monoform "+r.Version, func(ctx context.Context, rep *jobs.Reporter) (any, error) {
		if fakeUpdates() {
			for i := int64(1); i <= 4; i++ {
				rep.Set(i<<18, 1<<20, "")
				time.Sleep(60 * time.Millisecond)
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, err
			}
			p := filepath.Join(dir, r.Asset)
			return p, os.WriteFile(p, []byte("fake update"), 0o644)
		}
		return update.Download(ctx, r, dir, func(done, total int64) { rep.Set(done, total, "") })
	}), nil
}

// UpdateInstall puts the downloaded package in place and restarts into the
// new version (the frontend has already dealt with unsaved work).
func (a *App) UpdateInstall(pkg string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	if fakeUpdates() {
		log.Printf("update: would install %s over %s and restart", filepath.Base(pkg), exe)
		return nil
	}
	pid := strconv.Itoa(os.Getpid())
	var cmd *exec.Cmd
	switch installKind(exe) {
	case "installer":
		// The setup program waits for this one to close, installs into the
		// same place with the same choices, then starts the new version.
		cmd = exec.Command(pkg, "--update")
	case "manual":
		return fmt.Errorf("Monoform can't replace itself in %s; download the new version from the release page", filepath.Dir(exe))
	default:
		start, err := update.Apply(pkg, exe)
		if err != nil {
			return err
		}
		cmd = exec.Command(start[0], append(start[1:], "--after-update="+pid)...)
	}
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	_ = cmd.Process.Release()
	a.mu.Lock()
	a.forceQuit = true
	a.mu.Unlock()
	wruntime.Quit(a.ctx)
	return nil
}

// UpdateOpenRelease opens the release page in the browser (the fallback when a copy can't update itself).
func (a *App) UpdateOpenRelease() {
	updateMu.Lock()
	rel := updateRel
	updateMu.Unlock()
	url := "https://github.com/" + update.Repo + "/releases/latest"
	if rel != nil && rel.URL != "" {
		url = rel.URL
	}
	wruntime.BrowserOpenURL(a.ctx, url)
}
