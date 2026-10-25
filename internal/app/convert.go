package app

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/caffeine-runtime/monoform/internal/convert"
	"github.com/caffeine-runtime/monoform/internal/jobs"
)

// ConvertFormats lists, for each extension that converts, the formats it
// converts to (extensions, in the order they are offered).
func (a *App) ConvertFormats() map[string][]string { return convert.Formats() }

// ConvertFile writes src in dst's format as a background job; the job's
// result is a convert.Result (what had to be left out, if anything).
func (a *App) ConvertFile(src, dst string) (string, error) {
	if !filepath.IsAbs(src) || !filepath.IsAbs(dst) {
		return "", errors.New("absolute paths required")
	}
	return a.Jobs.Start("convert", "Converting "+filepath.Base(src), func(ctx context.Context, r *jobs.Reporter) (any, error) {
		if a.watcher != nil {
			a.watcher.NoteOwnWrite(dst)
		}
		res, err := convert.Convert(ctx, src, dst, func(done, total int64) { r.Set(done, total, "") })
		if a.watcher != nil {
			a.watcher.NoteOwnWrite(dst)
		}
		return res, err
	}), nil
}
