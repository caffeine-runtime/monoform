package app

import (
	"os"
	"path/filepath"
	"strings"
)

// saveDir is the folder a Save dialog opens in. A suggested path with a
// folder keeps it; a bare name ("Untitled.md", a new tab's title) goes to the
// folder last saved into, else Documents. Never the working directory: when
// Windows starts the app from Explorer, a file association or the installer,
// that is C:\Windows\System32 (or the install folder).
func saveDir(suggested, last, docs string) string {
	if dir := filepath.Dir(suggested); filepath.IsAbs(dir) {
		return dir
	}
	if last != "" {
		return last
	}
	return docs
}

// documentsDir is the user's Documents folder, or their home folder when
// there is none.
func documentsDir() string {
	if d := knownDocuments(); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	if d := xdgDocuments(home); d != "" {
		return d
	}
	if st, err := os.Stat(filepath.Join(home, "Documents")); err == nil && st.IsDir() {
		return filepath.Join(home, "Documents")
	}
	return home
}

// xdgDocuments reads XDG_DOCUMENTS_DIR from ~/.config/user-dirs.dirs (Linux
// desktops localise the folder's name, e.g. "Dokumenty").
func xdgDocuments(home string) string {
	data, err := os.ReadFile(filepath.Join(home, ".config", "user-dirs.dirs"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		v, ok := strings.CutPrefix(strings.TrimSpace(line), "XDG_DOCUMENTS_DIR=")
		if !ok {
			continue
		}
		v = strings.Trim(v, `"`)
		v = strings.Replace(v, "$HOME", home, 1)
		// "$HOME/" alone means the desktop has no Documents folder.
		if st, err := os.Stat(v); err == nil && st.IsDir() && filepath.Clean(v) != filepath.Clean(home) {
			return v
		}
	}
	return ""
}
