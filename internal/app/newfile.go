package app

import "github.com/caffeine-runtime/hold-it-all/internal/newfile"

// CreateFromTemplate creates a starter file of a kind ("markdown", "docx",
// "xlsx", "image", …); it fails if the path exists.
func (a *App) CreateFromTemplate(p, kind string, opts newfile.Options) error {
	return newfile.Create(p, kind, opts)
}

// Locations are where the app keeps its own data (shown in Settings).
type Locations struct {
	Settings string `json:"settings"`
	Cache    string `json:"cache"`
}

// DataLocations reports the settings file and cache folder.
func (a *App) DataLocations() Locations {
	return Locations{Settings: a.Settings.Path(), Cache: cacheDir()}
}
