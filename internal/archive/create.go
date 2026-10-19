package archive

import (
	"archive/zip"
	"context"
	"io"
	iofs "io/fs"
	"os"
	"path/filepath"
	"strings"

	hfs "github.com/caffeine-runtime/hold-it-all/internal/fs"
)

// CreateZip writes the given files and folders into a new zip at dest
// (atomically). Entries are named relative to each item's parent folder.
// Symlinks are stored as the files they point to only if they stay inside
// the selected folder; otherwise they are skipped.
func CreateZip(ctx context.Context, items []string, dest string, progress Progress) (Result, error) {
	var res Result
	destAbs, _ := filepath.Abs(dest)
	var total int64
	err := hfs.AtomicWrite(dest, func(w io.Writer) error {
		zw := zip.NewWriter(w)
		seen := map[string]bool{}
		for _, item := range items {
			item = filepath.Clean(item)
			base := filepath.Dir(item)
			err := filepath.WalkDir(item, func(p string, d iofs.DirEntry, err error) error {
				if err != nil {
					res.Skipped = append(res.Skipped, Skipped{p, err.Error()})
					return nil
				}
				if err := ctx.Err(); err != nil {
					return err
				}
				if abs, _ := filepath.Abs(p); abs == destAbs {
					return nil // don't put the zip into itself
				}
				rel, err := filepath.Rel(base, p)
				if err != nil {
					return err
				}
				name := filepath.ToSlash(rel)
				if d.Type()&iofs.ModeSymlink != 0 {
					res.Skipped = append(res.Skipped, Skipped{name, "symbolic link"})
					return nil
				}
				info, err := d.Info()
				if err != nil {
					res.Skipped = append(res.Skipped, Skipped{name, err.Error()})
					return nil
				}
				if seen[name] {
					return nil
				}
				seen[name] = true
				hdr, err := zip.FileInfoHeader(info)
				if err != nil {
					return err
				}
				hdr.Name = name
				if d.IsDir() {
					hdr.Name += "/"
					hdr.Method = zip.Store
					_, err := zw.CreateHeader(hdr)
					res.Dirs++
					return err
				}
				if !info.Mode().IsRegular() {
					res.Skipped = append(res.Skipped, Skipped{name, "special file"})
					return nil
				}
				hdr.Method = zip.Deflate
				if isCompressed(name) {
					hdr.Method = zip.Store
				}
				fw, err := zw.CreateHeader(hdr)
				if err != nil {
					return err
				}
				f, err := os.Open(p)
				if err != nil {
					res.Skipped = append(res.Skipped, Skipped{name, err.Error()})
					return nil
				}
				pw := &progressWriter{w: fw, done: total, name: name, fn: progress, ctx: ctx}
				n, err := io.Copy(pw, f)
				f.Close()
				total += n
				res.Bytes += n
				res.Files++
				return err
			})
			if err != nil {
				return err
			}
		}
		return zw.Close()
	})
	return res, err
}

// isCompressed reports formats that don't benefit from deflate.
func isCompressed(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".zip", ".gz", ".tgz", ".7z", ".rar", ".xz", ".bz2", ".zst", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp3", ".mp4", ".mkv", ".mov", ".avi", ".docx", ".xlsx", ".pptx", ".pdf":
		return true
	}
	return false
}
