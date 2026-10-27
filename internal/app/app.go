// Package app is the Wails-bound facade: every method on App is callable from
// the frontend (see frontend/wailsjs/go/app/App.d.ts). It owns the backend
// services and keeps each method thin.
package app

import (
	"context"
	"errors"
	iofs "io/fs"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/caffeine-runtime/monoform/internal/filetype"
	"github.com/caffeine-runtime/monoform/internal/fs"
	"github.com/caffeine-runtime/monoform/internal/history"
	"github.com/caffeine-runtime/monoform/internal/jobs"
	"github.com/caffeine-runtime/monoform/internal/locale"
	"github.com/caffeine-runtime/monoform/internal/notes"
	"github.com/caffeine-runtime/monoform/internal/office"
	"github.com/caffeine-runtime/monoform/internal/search"
	"github.com/caffeine-runtime/monoform/internal/server"
	"github.com/caffeine-runtime/monoform/internal/settings"
	"github.com/caffeine-runtime/monoform/internal/update"
)

var Version = "1.0.0-dev"

type App struct {
	ctx      context.Context
	start    time.Time
	Server   *server.Server
	Settings *settings.Store
	Jobs     *jobs.Manager
	watcher  *fs.Watcher
	books    *office.Books
	langs    func() []string // the system's languages, looked up once while the window starts
	notes    *notes.Scanner
	// History keeps earlier versions of saved files (nil if unavailable).
	History *history.Store
	// Assets is the frontend bundle (set by main): bundled OCR language data is read from it.
	Assets iofs.FS

	mu          sync.Mutex
	ready       bool
	pending     []string // files to open that arrived before the frontend was ready
	dirty       int
	forceQuit   bool
	launchFiles []string
	// recorderLayout is the recorder window's current shape ("panel" or "bar").
	recorderLayout string
	launchMode     string  // "peek", "preview", "convert", "window", "record", "recorded" or ""
	startAt        *[2]int // screen point to place the window at (see SetStartPosition)
	lastDir        string  // folder of the last file dialog answer (see saveDir, openDir)
}

// New creates the app. start is the process start time used for the
// startup-time measurement.
func New(start time.Time, launchFiles []string, launchMode string) *App {
	a := &App{start: start, launchFiles: launchFiles, launchMode: launchMode, books: office.NewBooks(), notes: notes.NewScanner(), langs: sync.OnceValue(locale.Languages)}
	go a.langs()
	a.Server = server.New(server.NewToken())
	server.RecordPages = os.Getenv("MF_TEST") != ""
	path, err := settings.DefaultPath()
	if err != nil {
		path = filepath.Join(os.TempDir(), "Monoform", "settings.json")
	}
	if p := os.Getenv("MF_SETTINGS"); p != "" {
		path = p
	}
	a.Settings, err = settings.Open(path)
	if err != nil {
		log.Printf("settings: %v", err)
	}
	a.openHistory(path)
	a.Jobs = jobs.NewManager(jobs.EmitterFunc(a.emit))
	a.Server.OnWrite = func(p string) {
		if a.watcher != nil {
			a.watcher.NoteOwnWrite(p)
		}
	}
	a.registerRoutes()
	a.registerRecordRoutes()
	a.registerModelRoute()
	a.registerAudioRoutes()
	return a
}

func (a *App) emit(event string, data any) {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, event, data)
	}
}

// Startup is the Wails OnStartup hook.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	w, err := fs.NewWatcher(func(ev fs.ChangeEvent) { a.emit("fs:changed", ev) })
	if err != nil {
		log.Printf("watcher: %v", err)
	} else {
		a.watcher = w
	}
}

// Shutdown is the Wails OnShutdown hook.
func (a *App) Shutdown(ctx context.Context) {
	a.Jobs.CancelAll()
	a.flushSemantic()
	cleanupTemp()
	if a.watcher != nil {
		a.watcher.Close()
	}
	if a.History != nil {
		a.History.Close()
	}
}

// BeforeClose asks the frontend to confirm when there are unsaved tabs.
func (a *App) BeforeClose(ctx context.Context) bool {
	a.mu.Lock()
	dirty, force := a.dirty, a.forceQuit
	a.mu.Unlock()
	if dirty > 0 && !force {
		a.emit("app:confirm-quit", dirty)
		return true
	}
	return false
}

// OpenFiles is called for files passed by the OS after launch (second
// instance, macOS open-file events).
func (a *App) OpenFiles(paths []string) { a.OpenFilesMode(paths, "") }

// OpenFilesMode opens files passed after launch, in preview mode when mode
// is "peek" or "preview" (a running window shows them as preview tabs).
func (a *App) OpenFilesMode(paths []string, mode string) {
	a.mu.Lock()
	if !a.ready {
		a.pending = append(a.pending, paths...)
		a.mu.Unlock()
		return
	}
	a.mu.Unlock()
	a.emit("app:open-files", OpenRequest{Paths: paths, Preview: mode == "peek" || mode == "preview", Recorded: mode == "recorded"})
	if a.ctx != nil {
		wruntime.WindowUnminimise(a.ctx)
		wruntime.Show(a.ctx)
	}
}

// OpenRequest asks the frontend to open files.
type OpenRequest struct {
	Paths   []string `json:"paths"`
	Preview bool     `json:"preview"`
	// Recorded: a screen recording that just finished (opened with a note
	// where it was saved).
	Recorded bool `json:"recorded"`
}

// BootInfo is everything the frontend needs to paint the shell.
type BootInfo struct {
	Token       string            `json:"token"`
	Settings    settings.Settings `json:"settings"`
	Platform    string            `json:"platform"`
	Version     string            `json:"version"`
	LaunchFiles []string          `json:"launchFiles"`
	LaunchMode  string            `json:"launchMode"` // "peek", "preview", "convert", "window", "record", "recorded" or ""
	Home        string            `json:"home"`
	PathSep     string            `json:"pathSep"`
	TestScript  string            `json:"testScript"`
	TestArg     string            `json:"testArg"`
	// SystemLanguages are the system's preferred languages ("pl-PL", …), for "like my computer".
	SystemLanguages []string `json:"systemLanguages"`
	// Store: the Microsoft Store build (an MSIX package), which the Store updates.
	Store bool `json:"store"`
}

// Boot returns startup info. Called once by the frontend before first paint.
func (a *App) Boot() BootInfo {
	home, _ := os.UserHomeDir()
	a.mu.Lock()
	files := append(append([]string{}, a.launchFiles...), a.pending...)
	a.pending = nil
	a.ready = true
	a.mu.Unlock()
	a.placeWindow()
	return BootInfo{
		Token:           a.Server.Token(),
		Settings:        a.Settings.Get(),
		Platform:        runtime.GOOS,
		Version:         Version,
		LaunchFiles:     files,
		LaunchMode:      a.launchMode,
		Home:            home,
		PathSep:         string(filepath.Separator),
		TestScript:      os.Getenv("MF_TEST"),
		TestArg:         os.Getenv("MF_TEST_ARG"),
		SystemLanguages: a.langs(),
		Store:           update.InStore(),
	}
}

// MarkReady is called by the frontend once the shell is interactive; it
// logs the cold-start time measured from process start.
func (a *App) MarkReady(jsMillis float64) int64 {
	ms := time.Since(a.start).Milliseconds()
	log.Printf("startup: interactive %d ms after process start (frontend %.0f ms after navigation)", ms, jsMillis)
	return ms
}

// Log lets the frontend write to the app log (used by the self-test mode).
func (a *App) Log(msg string) { log.Print(msg) }

// Quit exits immediately, used by the self-test harness.
func (a *App) Quit(code int) {
	a.mu.Lock()
	a.forceQuit = true
	a.mu.Unlock()
	if code != 0 {
		os.Exit(code)
	}
	wruntime.Quit(a.ctx)
}

// --- settings ---

func (a *App) SaveSettings(s settings.Settings) error {
	if a.launchMode == "window" || a.launchMode == "convert" || a.launchMode == "record" {
		s = keepSession(s, a.Settings.Path())
	}
	if err := a.Settings.Set(s); err != nil {
		return err
	}
	a.configureHistory(s)
	return nil
}

// --- files ---

func (a *App) ListDir(dir string) ([]fs.Entry, error)     { return fs.ListDir(dir) }
func (a *App) Stat(p string) (fs.Entry, error)            { return fs.Stat(p) }
func (a *App) DetectType(p string) (filetype.Info, error) { return filetype.Detect(p) }
func (a *App) Siblings(p string, kinds []string) ([]string, error) {
	return fs.Siblings(p, kinds)
}

// Exists reports which of paths exist (used when restoring the session).
func (a *App) Exists(paths []string) []bool {
	out := make([]bool, len(paths))
	for i, p := range paths {
		_, err := os.Stat(p)
		out[i] = err == nil
	}
	return out
}

// CreateFile creates an empty file (fails if it exists).
func (a *App) CreateFile(p string) error {
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	return f.Close()
}

// CreateFolder creates a directory.
func (a *App) CreateFolder(p string) error { return os.Mkdir(p, 0o755) }

// Rename renames a file or folder (fails if the target exists).
func (a *App) Rename(from, to string) error {
	if _, err := os.Lstat(to); err == nil {
		return os.ErrExist
	}
	if err := os.Rename(from, to); err != nil {
		return err
	}
	if a.History != nil {
		a.History.Moved(from, to)
	}
	return nil
}

func (a *App) WatchFile(p string) error {
	if a.watcher == nil {
		return nil
	}
	return a.watcher.WatchFile(p)
}
func (a *App) UnwatchFile(p string) {
	if a.watcher != nil {
		a.watcher.UnwatchFile(p)
	}
}
func (a *App) WatchDir(p string) error {
	if a.watcher == nil {
		return nil
	}
	return a.watcher.WatchDir(p)
}
func (a *App) UnwatchDir(p string) {
	if a.watcher != nil {
		a.watcher.UnwatchDir(p)
	}
}

// --- dialogs ---

type FileFilter struct {
	Name     string `json:"name"`
	Patterns string `json:"patterns"` // "*.png;*.jpg"
}

func toFilters(fs []FileFilter) []wruntime.FileFilter {
	out := make([]wruntime.FileFilter, len(fs))
	for i, f := range fs {
		out[i] = wruntime.FileFilter{DisplayName: f.Name, Pattern: f.Patterns}
	}
	return out
}

// dialogDir is where an Open dialog starts (see openDir), and remember
// notes the folder of an answer for the next dialog.
func (a *App) dialogDir() string {
	a.mu.Lock()
	last := a.lastDir
	a.mu.Unlock()
	return openDir(last, documentsDir())
}

func (a *App) remember(dir string) {
	if dir == "" || dir == "." {
		return
	}
	a.mu.Lock()
	a.lastDir = dir
	a.mu.Unlock()
}

func (a *App) OpenFilesDialog(title string, filters []FileFilter) ([]string, error) {
	ps, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{Title: title, Filters: toFilters(filters), DefaultDirectory: a.dialogDir()})
	if err == nil && len(ps) > 0 {
		a.remember(filepath.Dir(ps[0]))
	}
	return ps, err
}

func (a *App) OpenFolderDialog(title string) (string, error) {
	p, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{Title: title, CanCreateDirectories: true, DefaultDirectory: a.dialogDir()})
	if err == nil && p != "" {
		a.remember(filepath.Dir(p)) // next time: the folder it is in, with its neighbours
	}
	return p, err
}

func (a *App) SaveFileDialog(title, defaultPath string, filters []FileFilter) (string, error) {
	a.mu.Lock()
	last := a.lastDir
	a.mu.Unlock()
	name := ""
	if defaultPath != "" {
		name = filepath.Base(defaultPath)
	}
	p, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:                title,
		DefaultDirectory:     saveDir(defaultPath, last, documentsDir()),
		DefaultFilename:      name,
		Filters:              toFilters(filters),
		CanCreateDirectories: true,
	})
	if err == nil && p != "" {
		a.remember(filepath.Dir(p))
	}
	return p, err
}

// --- window / lifecycle ---

func (a *App) SetTitle(t string) { wruntime.WindowSetTitle(a.ctx, t) }

// SetDirtyCount tells the backend how many tabs have unsaved changes, so
// closing the window can ask first.
func (a *App) SetDirtyCount(n int) {
	a.mu.Lock()
	a.dirty = n
	a.mu.Unlock()
}

// ConfirmQuit closes the window after the user agreed to discard changes.
func (a *App) ConfirmQuit() {
	a.mu.Lock()
	a.forceQuit = true
	a.mu.Unlock()
	wruntime.Quit(a.ctx)
}

// --- jobs ---

func (a *App) CancelJob(id string) bool { return a.Jobs.Cancel(id) }

// QuickFiles lists files under root for the palette's quick-open.
func (a *App) QuickFiles(root string, limit int) []string { return fs.WalkFiles(root, limit) }

// --- search ---

// SearchFolder starts a folder search job; matches stream as job:data events.
func (a *App) SearchFolder(root string, opts search.Options) (string, error) {
	if _, err := search.Compile(opts); err != nil {
		return "", err
	}
	return a.Jobs.Start("search", "Searching "+filepath.Base(root), func(ctx context.Context, r *jobs.Reporter) (any, error) {
		return search.Run(ctx, root, opts, search.Sink{
			Matches:  func(m []search.Match) { r.Send(m) },
			Progress: func(scanned, found int64) { r.Set(scanned, found, "") },
		})
	}), nil
}

// CopyAsset copies src into an assets/ folder next to note (images dropped
// onto a markdown note) and returns the relative link.
func (a *App) CopyAsset(note, src string) (server.AssetResult, error) {
	f, err := os.Open(src)
	if err != nil {
		return server.AssetResult{}, err
	}
	defer f.Close()
	res, err := server.SaveAsset(note, filepath.Base(src), f)
	if err == nil && a.watcher != nil {
		a.watcher.NoteOwnWrite(res.Path)
	}
	return res, err
}

// RelPath returns target relative to the directory of from, with forward slashes.
func (a *App) RelPath(from, target string) (string, error) {
	rel, err := filepath.Rel(filepath.Dir(from), target)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(rel), nil
}

// OpenExternal opens an http(s)/mailto link in the user's browser. The app
// itself never makes network requests.
func (a *App) OpenExternal(url string) {
	if strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "mailto:") {
		wruntime.BrowserOpenURL(a.ctx, url)
	}
}

// TestServedPages lists files the HTML page route served since the last
// call. Only available in self-test mode (MF_TEST set).
func (a *App) TestServedPages() []string {
	if os.Getenv("MF_TEST") == "" {
		return nil
	}
	return a.Server.ServedPages()
}

// TestWriteFile simulates another program changing a file. Only available
// in self-test mode (MF_TEST set).
func (a *App) TestWriteFile(p, content string) error {
	if os.Getenv("MF_TEST") == "" {
		return os.ErrPermission
	}
	return os.WriteFile(p, []byte(content), 0o644)
}

// PageRoot returns a read-only token that serves dir to an HTML preview at
// /__mf/page/<token>/ (see server/pages.go).
func (a *App) PageRoot(dir string) (string, error) { return a.Server.PageRoot(dir) }

// OpenInBrowser opens an existing local HTML or SVG file in the default
// browser (where its scripts and remote content run normally).
func (a *App) OpenInBrowser(p string) error {
	ext := strings.ToLower(filepath.Ext(p))
	if ext != ".html" && ext != ".htm" && ext != ".xhtml" && ext != ".svg" {
		return errors.New("only HTML and SVG files can be opened in the browser")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return err
	}
	if st, err := os.Stat(abs); err != nil || st.IsDir() {
		return errors.New("file not found")
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(abs)}
	if runtime.GOOS == "windows" {
		u.Path = "/" + u.Path
	}
	wruntime.BrowserOpenURL(a.ctx, u.String())
	return nil
}
