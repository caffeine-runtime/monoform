package app

import (
	"path/filepath"

	"github.com/caffeine-runtime/hold-it-all/internal/newfile"
)

// CreateFromTemplate creates a starter file of a kind ("markdown", "docx",
// "xlsx", "image", …); it fails if the path exists.
func (a *App) CreateFromTemplate(p, kind string, opts newfile.Options) error {
	return newfile.Create(p, kind, opts)
}

// Locations are where the app keeps its own data (shown in Settings).
type Locations struct {
	Settings string `json:"settings"`
	Cache    string `json:"cache"`
	History  string `json:"history"`
}

// DataLocations reports the settings file, cache and file history folders.
func (a *App) DataLocations() Locations {
	return Locations{Settings: a.Settings.Path(), Cache: cacheDir(), History: filepath.Join(filepath.Dir(a.Settings.Path()), "history")}
}
