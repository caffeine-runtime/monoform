package fs

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/caffeine-runtime/monoform/internal/filetype"
)

// Entry describes one file or directory for the sidebar and dialogs.
type Entry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"` // Unix milliseconds
	Kind    string `json:"kind"`    // filetype kind by extension; "" for directories
	Hidden  bool   `json:"hidden"`
}

// skipDirs are never shown in the tree: they are large and rarely what you
// want to browse.
var skipDirs = map[string]bool{".git": true, ".hg": true, ".svn": true, "node_modules": true, ".DS_Store": true}

// ListDir returns the entries of dir sorted directories-first, then by name
// (case-insensitive, numbers in natural order).
func ListDir(dir string) ([]Entry, error) {
	des, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(des))
	for _, de := range des {
		name := de.Name()
		if skipDirs[name] {
			continue
		}
		info, err := de.Info()
		if err != nil {
			continue
		}
		p := filepath.Join(dir, name)
		isDir := info.IsDir()
		if info.Mode()&os.ModeSymlink != 0 {
			if st, err := os.Stat(p); err == nil {
				isDir = st.IsDir()
				info = st
			}
		}
		e := Entry{
			Name:    name,
			Path:    p,
			IsDir:   isDir,
			Size:    info.Size(),
			ModTime: info.ModTime().UnixMilli(),
			Hidden:  strings.HasPrefix(name, "."),
		}
		if !isDir {
			e.Kind = string(filetype.ByName(name).Kind)
		}
		out = append(out, e)
	}
	SortEntries(out)
	return out, nil
}

// SortEntries orders directories first, then by natural name order.
func SortEntries(es []Entry) {
	sort.SliceStable(es, func(i, j int) bool {
		if es[i].IsDir != es[j].IsDir {
			return es[i].IsDir
		}
		return NaturalLess(es[i].Name, es[j].Name)
	})
}

// Stat returns an Entry for a single path.
func Stat(p string) (Entry, error) {
	st, err := os.Stat(p)
	if err != nil {
		return Entry{}, err
	}
	e := Entry{
		Name:    filepath.Base(p),
		Path:    p,
		IsDir:   st.IsDir(),
		Size:    st.Size(),
		ModTime: st.ModTime().UnixMilli(),
		Hidden:  strings.HasPrefix(filepath.Base(p), "."),
	}
	if !e.IsDir {
		e.Kind = string(filetype.ByName(p).Kind)
	}
	return e, nil
}

// Siblings lists the files next to p whose filetype kind is one of kinds, in
// natural order. Used for next/previous image navigation.
func Siblings(p string, kinds []string) ([]string, error) {
	want := map[string]bool{}
	for _, k := range kinds {
		want[k] = true
	}
	es, err := ListDir(filepath.Dir(p))
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range es {
		if !e.IsDir && want[e.Kind] {
			out = append(out, e.Path)
		}
	}
	return out, nil
}

// NaturalLess compares strings case-insensitively, treating digit runs as
// numbers so "img2" sorts before "img10".
func NaturalLess(a, b string) bool {
	a, b = strings.ToLower(a), strings.ToLower(b)
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		ca, cb := a[i], b[j]
		if isDigit(ca) && isDigit(cb) {
			si := i
			for i < len(a) && isDigit(a[i]) {
				i++
			}
			sj := j
			for j < len(b) && isDigit(b[j]) {
				j++
			}
			na := strings.TrimLeft(a[si:i], "0")
			nb := strings.TrimLeft(b[sj:j], "0")
			if len(na) != len(nb) {
				return len(na) < len(nb)
			}
			if na != nb {
				return na < nb
			}
			continue
		}
		if ca != cb {
			return ca < cb
		}
		i++
		j++
	}
	return len(a)-i < len(b)-j
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// WalkFiles lists up to limit files below root (skipping VCS, node_modules
// and hidden directories) for quick-open in the command palette.
func WalkFiles(root string, limit int) []string {
	var out []string
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if p != root && (skipDirs[name] || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		out = append(out, p)
		if len(out) >= limit {
			return filepath.SkipAll
		}
		return nil
	})
	return out
}
