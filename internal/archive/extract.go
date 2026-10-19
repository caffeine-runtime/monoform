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
	"runtime"
	"strings"

	"github.com/mholt/archives"
)

// Limits protect against decompression bombs.
type Limits struct {
	MaxEntries int   `json:"maxEntries"` // files + dirs + links
	MaxBytes   int64 `json:"maxBytes"`   // total bytes written
	// MaxRatio caps (bytes written / archive size) once more than RatioFloor
	// bytes have been written.
	MaxRatio   float64 `json:"maxRatio"`
	RatioFloor int64   `json:"ratioFloor"`
}

func DefaultLimits() Limits {
	return Limits{MaxEntries: 200_000, MaxBytes: 32 << 30, MaxRatio: 1000, RatioFloor: 1 << 30}
}

var (
	ErrTooManyEntries = errors.New("the archive has too many entries (possible decompression bomb)")
	ErrTooLarge       = errors.New("extracting would exceed the size limit (possible decompression bomb)")
	ErrRatio          = errors.New("the archive expands suspiciously much (possible decompression bomb)")
)

// Existing decides what happens when a file already exists at the target.
type Existing string

const (
	Skip      Existing = "skip"
	Overwrite Existing = "overwrite"
	Rename    Existing = "rename"
)

type Options struct {
	// Entries to extract (files or folders, forward slashes). Empty = all.
	Entries []string `json:"entries"`
	// Output paths are relative to the parent of each selected entry, so
	// extracting the folder "a/b" creates "b/…". With no selection, full paths.
	Existing Existing `json:"existing"`
	Limits   Limits   `json:"limits"`
}

type Skipped struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

type Result struct {
	Files   int       `json:"files"`
	Dirs    int       `json:"dirs"`
	Links   int       `json:"links"`
	Bytes   int64     `json:"bytes"`
	Skipped []Skipped `json:"skipped"`
}

// Progress is called with bytes written so far.
type Progress func(written int64, current string)

// Extract writes the selected entries of archive p into dest.
func Extract(ctx context.Context, p, dest string, opts Options, progress Progress) (Result, error) {
	var res Result
	if opts.Limits == (Limits{}) {
		opts.Limits = DefaultLimits()
	}
	if opts.Existing == "" {
		opts.Existing = Rename
	}
	st, err := os.Stat(p)
	if err != nil {
		return res, err
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return res, err
	}
	root, err := os.OpenRoot(dest)
	if err != nil {
		return res, err
	}
	defer root.Close()

	sel := make([]string, 0, len(opts.Entries))
	for _, e := range opts.Entries {
		if e = cleanName(e); e != "" {
			sel = append(sel, e)
		}
	}
	// outName maps an entry to its output name, or "" if not selected.
	outName := func(name string) string {
		if len(sel) == 0 {
			return name
		}
		for _, s := range sel {
			if name == s || strings.HasPrefix(name, s+"/") {
				base := path.Dir(s)
				if base == "." {
					return name
				}
				return strings.TrimPrefix(name, base+"/")
			}
		}
		return ""
	}
	entries := 0
	limitErr := func() error {
		l := opts.Limits
		if l.MaxBytes > 0 && res.Bytes > l.MaxBytes {
			return ErrTooLarge
		}
		if l.MaxRatio > 0 && res.Bytes > l.RatioFloor && st.Size() > 0 && float64(res.Bytes)/float64(st.Size()) > l.MaxRatio {
			return ErrRatio
		}
		return nil
	}

	_, err = walk(ctx, p, func(info archives.FileInfo, name string) error {
		out := outName(name)
		if out == "" {
			return nil
		}
		entries++
		if opts.Limits.MaxEntries > 0 && entries > opts.Limits.MaxEntries {
			return ErrTooManyEntries
		}
		local, err := safeLocal(out)
		if err != nil {
			res.Skipped = append(res.Skipped, Skipped{name, err.Error()})
			return nil
		}
		mode := info.Mode()
		switch {
		case info.IsDir():
			if err := root.MkdirAll(local, 0o755); err != nil {
				res.Skipped = append(res.Skipped, Skipped{name, err.Error()})
				return nil
			}
			res.Dirs++
			return nil
		case mode&iofs.ModeSymlink != 0 || (info.LinkTarget != "" && mode.Type() != 0):
			return extractLink(root, local, out, name, info, &res)
		case !mode.IsRegular() && mode.Type() != 0:
			res.Skipped = append(res.Skipped, Skipped{name, "special file (device, pipe or hard link)"})
			return nil
		}
		if info.LinkTarget != "" {
			// tar hard links: refuse rather than duplicate content silently.
			res.Skipped = append(res.Skipped, Skipped{name, "hard link"})
			return nil
		}
		if dir := filepath.Dir(local); dir != "." {
			if err := root.MkdirAll(dir, 0o755); err != nil {
				res.Skipped = append(res.Skipped, Skipped{name, err.Error()})
				return nil
			}
		}
		target, ok := resolveExisting(root, local, opts.Existing)
		if !ok {
			res.Skipped = append(res.Skipped, Skipped{name, "already exists"})
			return nil
		}
		perm := mode.Perm() & 0o777
		if perm == 0 {
			perm = 0o644
		}
		perm |= 0o600
		w, err := root.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
		if err != nil {
			res.Skipped = append(res.Skipped, Skipped{name, err.Error()})
			return nil
		}
		r, err := info.Open()
		if err != nil {
			w.Close()
			root.Remove(target)
			return fmt.Errorf("%s: %w", name, err)
		}
		budget := int64(1<<62 - 1)
		if opts.Limits.MaxBytes > 0 {
			budget = opts.Limits.MaxBytes - res.Bytes
		}
		pw := &progressWriter{w: w, done: res.Bytes, name: out, fn: progress, ctx: ctx}
		n, copyErr := io.Copy(pw, io.LimitReader(r, budget+1))
		r.Close()
		closeErr := w.Close()
		res.Bytes += n
		if copyErr == nil {
			copyErr = closeErr
		}
		if copyErr == nil {
			copyErr = limitErr()
		}
		if copyErr != nil {
			root.Remove(target)
			return copyErr
		}
		if !info.ModTime().IsZero() {
			root.Chtimes(target, info.ModTime(), info.ModTime())
		}
		res.Files++
		return nil
	})
	return res, err
}

func extractLink(root *os.Root, local, out, name string, info archives.FileInfo, res *Result) error {
	target := info.LinkTarget
	if target == "" {
		res.Skipped = append(res.Skipped, Skipped{name, "link without target"})
		return nil
	}
	t := strings.ReplaceAll(target, "\\", "/")
	if strings.HasPrefix(t, "/") || (len(t) > 1 && t[1] == ':') {
		res.Skipped = append(res.Skipped, Skipped{name, "link points to an absolute path"})
		return nil
	}
	resolved := path.Join(path.Dir(out), t)
	if _, err := safeLocal(resolved); err != nil || resolved == "." {
		res.Skipped = append(res.Skipped, Skipped{name, "link points outside the destination"})
		return nil
	}
	if runtime.GOOS == "windows" {
		res.Skipped = append(res.Skipped, Skipped{name, "symbolic links are not created on Windows"})
		return nil
	}
	if dir := filepath.Dir(local); dir != "." {
		if err := root.MkdirAll(dir, 0o755); err != nil {
			res.Skipped = append(res.Skipped, Skipped{name, err.Error()})
			return nil
		}
	}
	if err := root.Symlink(filepath.FromSlash(t), local); err != nil {
		res.Skipped = append(res.Skipped, Skipped{name, err.Error()})
		return nil
	}
	res.Links++
	return nil
}

// resolveExisting returns the path to write, applying the existing-file policy.
func resolveExisting(root *os.Root, local string, policy Existing) (string, bool) {
	if _, err := root.Lstat(local); errors.Is(err, os.ErrNotExist) {
		return local, true
	}
	switch policy {
	case Overwrite:
		// Never write through an existing symlink.
		if fi, err := root.Lstat(local); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			root.Remove(local)
		}
		return local, true
	case Rename:
		ext := filepath.Ext(local)
		stem := strings.TrimSuffix(local, ext)
		for i := 2; i < 10000; i++ {
			c := fmt.Sprintf("%s (%d)%s", stem, i, ext)
			if _, err := root.Lstat(c); errors.Is(err, os.ErrNotExist) {
				return c, true
			}
		}
	}
	return "", false
}

type progressWriter struct {
	w    io.Writer
	done int64
	name string
	fn   Progress
	ctx  context.Context
}

func (p *progressWriter) Write(b []byte) (int, error) {
	if err := p.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := p.w.Write(b)
	p.done += int64(n)
	if p.fn != nil {
		p.fn(p.done, p.name)
	}
	return n, err
}
