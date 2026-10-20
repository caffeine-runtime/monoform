// Package archive lists, reads and extracts archives (zip, tar, tar.gz/bz2/xz/
// zst, gz, 7z, rar) with github.com/mholt/archives, and creates zip files.
//
// Extraction is defensive: entry names that are absolute or climb out of the
// destination ("zip slip") are refused, symlinks may only point inside the
// destination, all writes go through an os.Root so even a symlink created
// earlier can't redirect a later write, and limits on entry count, total size
// and compression ratio stop decompression bombs.
package archive

import (
	"context"
	"errors"
	"fmt"
	"io"
	iofs "io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mholt/archives"
)

// Entry is one item in an archive. Name uses forward slashes.
type Entry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"` // -1 when unknown (single compressed streams)
	ModTime int64  `json:"modTime"`
	IsDir   bool   `json:"isDir"`
	Link    string `json:"link,omitempty"`
}

// Info describes an archive and its capabilities.
type Info struct {
	Format string `json:"format"` // e.g. "zip", "tar.gz", "7z", "rar", "gz"
	// Writable formats can be created by the app (only zip). RAR and 7z can
	// be browsed and extracted but never created or modified.
	Writable bool    `json:"writable"`
	Entries  []Entry `json:"entries"`
	// Meta describes packages and disc images (name, version, volume label…).
	Meta map[string]string `json:"meta,omitempty"`
}

var (
	ErrNotArchive = errors.New("not a supported archive")
	ErrStop       = errors.New("stop")
)

func identify(ctx context.Context, f *os.File) (archives.Format, error) {
	format, _, err := archives.Identify(ctx, f.Name(), f)
	if err != nil {
		if errors.Is(err, archives.NoMatch) {
			return nil, ErrNotArchive
		}
		return nil, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return format, nil
}

func formatName(f archives.Format) string {
	ext := strings.TrimPrefix(f.Extension(), ".")
	return ext
}

// walk calls fn for every entry of the archive at p. Single compressed files
// (file.txt.gz) appear as one entry named after the file.
// walkResult says what walk found: the format's name, whether the app can
// write it, and package/disc metadata.
type walkResult struct {
	name     string
	writable bool
	meta     map[string]string
}

func walk(ctx context.Context, p string, fn func(info archives.FileInfo, name string) error) (walkResult, error) {
	f, err := os.Open(p)
	if err != nil {
		return walkResult{}, err
	}
	defer f.Close()
	if kind := customKind(f); kind != "" {
		meta, err := walkCustom(ctx, kind, f, fn)
		if errors.Is(err, ErrStop) {
			err = nil
		}
		return walkResult{name: kind, meta: meta}, wrapErr(err)
	}
	format, err := identify(ctx, f)
	if err != nil {
		return walkResult{}, err
	}
	res := walkResult{name: formatName(format)}
	_, res.writable = format.(archives.Zip)
	if ex, ok := format.(archives.Extractor); ok {
		err := ex.Extract(ctx, f, func(ctx context.Context, info archives.FileInfo) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			return fn(info, cleanName(info.NameInArchive))
		})
		if errors.Is(err, ErrStop) {
			err = nil
		}
		return res, wrapErr(err)
	}
	if dec, ok := format.(archives.Decompressor); ok {
		st, _ := f.Stat()
		name := strings.TrimSuffix(filepath.Base(p), format.Extension())
		if name == filepath.Base(p) || name == "" {
			name = strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
		}
		info := archives.FileInfo{
			FileInfo:      singleInfo{name: name, mod: st.ModTime()},
			NameInArchive: name,
			Open: func() (iofs.File, error) {
				rc, err := dec.OpenReader(f)
				if err != nil {
					return nil, err
				}
				return streamFile{rc, singleInfo{name: name, mod: st.ModTime()}}, nil
			},
		}
		err := fn(info, name)
		if errors.Is(err, ErrStop) {
			err = nil
		}
		return res, err
	}
	return walkResult{}, ErrNotArchive
}

func wrapErr(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "password") || strings.Contains(msg, "encrypt") {
		return errors.New("this archive is password-protected (opening encrypted archives arrives with the encryption tools)")
	}
	return err
}

type singleInfo struct {
	name string
	mod  time.Time
}

func (s singleInfo) Name() string        { return s.name }
func (s singleInfo) Size() int64         { return -1 }
func (s singleInfo) Mode() iofs.FileMode { return 0o644 }
func (s singleInfo) ModTime() time.Time  { return s.mod }
func (s singleInfo) IsDir() bool         { return false }
func (s singleInfo) Sys() any            { return nil }

type streamFile struct {
	io.ReadCloser
	info singleInfo
}

func (s streamFile) Stat() (iofs.FileInfo, error) { return s.info, nil }

// cleanName normalizes an entry name to forward slashes without a leading
// "./" or trailing slash. It does NOT make it safe; see safeLocal.
func cleanName(n string) string {
	n = strings.ReplaceAll(n, "\\", "/")
	n = strings.TrimPrefix(n, "./")
	return strings.TrimSuffix(n, "/")
}

// safeLocal returns the OS path for an entry name if it stays inside the
// destination, or an error describing why not.
func safeLocal(name string) (string, error) {
	if name == "" || strings.ContainsRune(name, 0) {
		return "", errors.New("empty or invalid name")
	}
	if strings.HasPrefix(name, "/") || (len(name) > 1 && name[1] == ':') {
		return "", errors.New("absolute path")
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".." {
			return "", errors.New("path leaves the destination (..)")
		}
	}
	p := filepath.FromSlash(name)
	if !filepath.IsLocal(p) {
		return "", errors.New("path leaves the destination or uses a reserved name")
	}
	return p, nil
}

// ---- listing (cached) ----

type cacheKey struct {
	path string
	size int64
	mod  int64
}

var (
	cacheMu sync.Mutex
	cache   = map[cacheKey]Info{}
	order   []cacheKey
)

// List returns the archive's entries, including directories implied by
// file paths, sorted by name.
func List(ctx context.Context, p string) (Info, error) {
	st, err := os.Stat(p)
	if err != nil {
		return Info{}, err
	}
	key := cacheKey{p, st.Size(), st.ModTime().UnixNano()}
	cacheMu.Lock()
	if info, ok := cache[key]; ok {
		cacheMu.Unlock()
		return info, nil
	}
	cacheMu.Unlock()

	seen := map[string]bool{}
	var entries []Entry
	addDir := func(name string) {
		for d := path.Dir(name); d != "." && d != "/" && d != ""; d = path.Dir(d) {
			if seen[d] {
				break
			}
			seen[d] = true
			entries = append(entries, Entry{Name: d, IsDir: true, Size: 0})
		}
	}
	res, err := walk(ctx, p, func(info archives.FileInfo, name string) error {
		if name == "" || seen[name] {
			return nil
		}
		seen[name] = true
		e := Entry{Name: name, IsDir: info.IsDir(), Size: info.Size(), ModTime: info.ModTime().UnixMilli(), Link: info.LinkTarget}
		if e.IsDir {
			e.Size = 0
		}
		entries = append(entries, e)
		addDir(name)
		return nil
	})
	if err != nil {
		return Info{}, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	info := Info{Format: res.name, Writable: res.writable, Entries: entries, Meta: res.meta}
	cacheMu.Lock()
	cache[key] = info
	order = append(order, key)
	if len(order) > 8 {
		delete(cache, order[0])
		order = order[1:]
	}
	cacheMu.Unlock()
	return info, nil
}

// ReadEntry streams one file from the archive to w (at most limit bytes).
func ReadEntry(ctx context.Context, p, entry string, w io.Writer, limit int64) error {
	entry = cleanName(entry)
	found := false
	_, err := walk(ctx, p, func(info archives.FileInfo, name string) error {
		if name != entry || info.IsDir() {
			return nil
		}
		found = true
		r, err := info.Open()
		if err != nil {
			return err
		}
		defer r.Close()
		n, err := io.Copy(w, io.LimitReader(r, limit+1))
		if err != nil {
			return err
		}
		if n > limit {
			return fmt.Errorf("%s is larger than %d MB; extract it instead", entry, limit>>20)
		}
		return ErrStop
	})
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("%s: %w", entry, os.ErrNotExist)
	}
	return nil
}
