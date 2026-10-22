// Package settings persists user preferences, recents, pinned items and the
// tab session as JSON in the OS config directory.
package settings

import (
	"encoding/json"
	"errors"
	iofs "io/fs"
	"math"
	"os"
	"path/filepath"
	"sync"

	"github.com/caffeine-runtime/monoform/internal/fs"
)

const MaxRecents = 30

// SessionTab is one tab to restore on launch.
type SessionTab struct {
	Kind   string `json:"kind"`             // "file", "archive-entry" or "tool"
	Path   string `json:"path,omitempty"`   // file path, or archive path for archive entries
	Entry  string `json:"entry,omitempty"`  // entry name inside the archive
	Tool   string `json:"tool,omitempty"`   // tool id, e.g. "hash"
	Module string `json:"module,omitempty"` // module that handled the tab
	State  string `json:"state,omitempty"`  // module-defined JSON (view mode, scroll, ...)
	Pinned bool   `json:"pinned,omitempty"`
}

// SessionSplit is a split view: up to four tabs shown at once.
type SessionSplit struct {
	Layout string  `json:"layout"` // "columns", "rows" or "grid"
	Panes  []int   `json:"panes"`  // tab indices, one per pane
	X      float64 `json:"x"`      // divider positions, 0.15..0.85
	Y      float64 `json:"y"`
}

type Session struct {
	Folder string       `json:"folder"`
	Tabs   []SessionTab `json:"tabs"`
	Active int          `json:"active"`
	// Split is nil when one tab fills the window.
	Split *SessionSplit `json:"split,omitempty"`
	// Expanded folder-tree directories, so the tree reopens as it was.
	Expanded []string `json:"expanded"`
}

// Semantic configures the optional search by meaning (off by default).
type Semantic struct {
	Enabled bool `json:"enabled"`
	// UnloadAfter is how many idle seconds the model stays in memory.
	UnloadAfter int `json:"unloadAfter"`
}

type Settings struct {
	Version        int      `json:"version"`
	Theme          string   `json:"theme"` // "system", "dark" or "light"
	Recents        []string `json:"recents"`
	RecentFolders  []string `json:"recentFolders"`
	Pinned         []string `json:"pinned"`
	SidebarVisible bool     `json:"sidebarVisible"`
	SidebarWidth   int      `json:"sidebarWidth"`
	ShowHidden     bool     `json:"showHidden"`
	WordWrap       bool     `json:"wordWrap"`
	FontSize       int      `json:"fontSize"`
	// UIScale enlarges or shrinks the whole interface (0.75..2).
	UIScale float64 `json:"uiScale"`
	// MinimapOff hides the code editor's minimap (shown by default).
	MinimapOff bool `json:"minimapOff"`
	// ShowWhitespace marks spaces and tabs in the code editor.
	ShowWhitespace bool     `json:"showWhitespace"`
	Session        Session  `json:"session"`
	Semantic       Semantic `json:"semantic"`
	// RecentsOff stops recording recent files and folders.
	RecentsOff bool `json:"recentsOff"`
	// ImageKeepOriginal makes Save write an edited image to a copy next to
	// the original instead of overwriting it.
	ImageKeepOriginal bool `json:"imageKeepOriginal"`
	// Signatures are saved PDF signatures (PNG data URLs, newest first).
	Signatures []string `json:"signatures"`
	// OcrLangs are the languages text recognition uses (Tesseract codes, e.g. "eng", "pol").
	OcrLangs []string `json:"ocrLangs"`
	// OpenInPreview opens files read-only until the user chooses Edit.
	OpenInPreview bool `json:"openInPreview"`
	// HistoryOff stops keeping earlier versions of saved files.
	HistoryOff bool `json:"historyOff"`
	// HistoryMaxMB caps the space kept versions take (0: 2 GB).
	HistoryMaxMB int `json:"historyMaxMB"`
	// HistoryKeep is how many versions each file keeps at most (0: 100).
	HistoryKeep int `json:"historyKeep"`
	// WelcomeDone is set once the first-run welcome has been seen.
	WelcomeDone bool `json:"welcomeDone"`
	// PathBarOff hides the path above the open file.
	PathBarOff bool `json:"pathBarOff"`
	// PanelsHidden hides editors' side panels (layers, adjustments, …) for more room.
	PanelsHidden bool `json:"panelsHidden"`
	// LightCanvases keeps drawings and diagrams (Excalidraw, draw.io, Mermaid,
	// Graphviz) on white in the dark theme instead of darkening them.
	LightCanvases bool `json:"lightCanvases"`
	// Language of the interface: "en", "pl", "es", or "" to follow the system.
	Language string `json:"language"`
	// UpdateCheckOff stops looking for a new version at startup.
	UpdateCheckOff bool `json:"updateCheckOff"`
	// UpdateSkip is a version the user chose to skip (not offered again).
	UpdateSkip string `json:"updateSkip"`
}

func Defaults() Settings {
	return Settings{
		Version:        1,
		Theme:          "system",
		Recents:        []string{},
		RecentFolders:  []string{},
		Pinned:         []string{},
		Signatures:     []string{},
		OcrLangs:       []string{"eng"},
		SidebarVisible: true,
		SidebarWidth:   260,
		FontSize:       14,
		UIScale:        1,
		Session:        Session{Tabs: []SessionTab{}, Expanded: []string{}},
		Semantic:       Semantic{UnloadAfter: 60},
	}
}

// Store loads and saves settings at a fixed path. It is safe for concurrent use.
type Store struct {
	path string
	mu   sync.Mutex
	cur  Settings
}

// DefaultPath returns <UserConfigDir>/Monoform/settings.json.
func DefaultPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "Monoform", "settings.json"), nil
}

// Open loads the settings file, falling back to defaults when it is missing
// or unreadable (a corrupt file is kept as settings.json.bad).
func Open(path string) (*Store, error) {
	s := &Store{path: path, cur: Defaults()}
	data, err := os.ReadFile(path)
	switch {
	case errors.Is(err, iofs.ErrNotExist):
		return s, nil
	case err != nil:
		return s, err
	}
	loaded := Defaults()
	if err := json.Unmarshal(data, &loaded); err != nil {
		os.Rename(path, path+".bad")
		return s, nil
	}
	s.cur = normalize(loaded)
	return s, nil
}

func (s *Store) Path() string { return s.path }

func (s *Store) Get() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return clone(s.cur)
}

// Set replaces all settings and writes them to disk.
func (s *Store) Set(v Settings) error {
	s.mu.Lock()
	s.cur = normalize(clone(v))
	snapshot := clone(s.cur)
	s.mu.Unlock()
	return s.write(snapshot)
}

// Update applies fn to a copy of the settings and saves the result.
func (s *Store) Update(fn func(*Settings)) (Settings, error) {
	s.mu.Lock()
	next := clone(s.cur)
	fn(&next)
	s.cur = normalize(next)
	snapshot := clone(s.cur)
	s.mu.Unlock()
	return snapshot, s.write(snapshot)
}

func (s *Store) write(v Settings) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return fs.AtomicWriteFile(s.path, data)
}

// AddRecent moves path to the front of list, removing duplicates and
// trimming to MaxRecents.
func AddRecent(list []string, path string) []string {
	out := make([]string, 0, len(list)+1)
	out = append(out, path)
	for _, p := range list {
		if p != path {
			out = append(out, p)
		}
	}
	if len(out) > MaxRecents {
		out = out[:MaxRecents]
	}
	return out
}

func normalize(v Settings) Settings {
	d := Defaults()
	switch v.Theme {
	case "system", "dark", "light":
	default:
		v.Theme = d.Theme
	}
	if v.Recents == nil {
		v.Recents = []string{}
	}
	if v.RecentFolders == nil {
		v.RecentFolders = []string{}
	}
	if v.Pinned == nil {
		v.Pinned = []string{}
	}
	if v.Signatures == nil {
		v.Signatures = []string{}
	}
	if len(v.Signatures) > 12 {
		v.Signatures = v.Signatures[:12]
	}
	if len(v.Recents) > MaxRecents {
		v.Recents = v.Recents[:MaxRecents]
	}
	if v.SidebarWidth < 160 || v.SidebarWidth > 640 {
		v.SidebarWidth = d.SidebarWidth
	}
	if v.FontSize < 8 || v.FontSize > 40 {
		v.FontSize = d.FontSize
	}
	if v.Session.Tabs == nil {
		v.Session.Tabs = []SessionTab{}
	}
	if v.Session.Expanded == nil {
		v.Session.Expanded = []string{}
	}
	if v.Session.Active < 0 || v.Session.Active >= len(v.Session.Tabs) {
		v.Session.Active = 0
	}
	if v.UIScale < 0.75 || v.UIScale > 2 {
		v.UIScale = d.UIScale
	}
	if sp := v.Session.Split; sp != nil {
		ok := (sp.Layout == "columns" || sp.Layout == "rows" || sp.Layout == "grid") && len(sp.Panes) >= 2 && len(sp.Panes) <= 4
		seen := map[int]bool{}
		for _, p := range sp.Panes {
			ok = ok && p >= 0 && p < len(v.Session.Tabs) && !seen[p]
			seen[p] = true
		}
		if !ok {
			v.Session.Split = nil
		} else {
			clamp := func(x float64) float64 { return math.Min(0.85, math.Max(0.15, x)) }
			if sp.X == 0 {
				sp.X = 0.5
			}
			if sp.Y == 0 {
				sp.Y = 0.5
			}
			sp.X, sp.Y = clamp(sp.X), clamp(sp.Y)
		}
	}
	if v.Semantic.UnloadAfter < 10 || v.Semantic.UnloadAfter > 3600 {
		v.Semantic.UnloadAfter = d.Semantic.UnloadAfter
	}
	if v.RecentsOff {
		v.Recents, v.RecentFolders = []string{}, []string{}
	}
	v.Version = d.Version
	return v
}

func clone(v Settings) Settings {
	v.Recents = append([]string{}, v.Recents...)
	v.RecentFolders = append([]string{}, v.RecentFolders...)
	v.Pinned = append([]string{}, v.Pinned...)
	v.Session.Tabs = append([]SessionTab{}, v.Session.Tabs...)
	v.Session.Expanded = append([]string{}, v.Session.Expanded...)
	if v.Session.Split != nil {
		sp := *v.Session.Split
		sp.Panes = append([]int{}, sp.Panes...)
		v.Session.Split = &sp
	}
	return v
}
