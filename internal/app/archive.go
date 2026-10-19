package app

import (
	"context"
	"path/filepath"

	"github.com/caffeine-runtime/hold-it-all/internal/archive"
	"github.com/caffeine-runtime/hold-it-all/internal/jobs"
)

// ArchiveList returns the entries of an archive.
func (a *App) ArchiveList(path string) (archive.Info, error) {
	return archive.List(context.Background(), path)
}

// ArchiveExtract extracts entries (empty = all) into dest as a background job.
func (a *App) ArchiveExtract(path, dest string, opts archive.Options) string {
	return a.Jobs.Start("extract", "Extracting "+filepath.Base(path), func(ctx context.Context, r *jobs.Reporter) (any, error) {
		return archive.Extract(ctx, path, dest, opts, func(written int64, current string) { r.Set(written, 0, current) })
	})
}

// ArchiveCreateZip zips files/folders into dest as a background job.
func (a *App) ArchiveCreateZip(items []string, dest string) string {
	return a.Jobs.Start("zip", "Creating "+filepath.Base(dest), func(ctx context.Context, r *jobs.Reporter) (any, error) {
		res, err := archive.CreateZip(ctx, items, dest, func(written int64, current string) { r.Set(written, 0, current) })
		if err == nil && a.watcher != nil {
			a.watcher.NoteOwnWrite(dest)
		}
		return res, err
	})
}
