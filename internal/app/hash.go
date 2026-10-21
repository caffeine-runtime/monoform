package app

import (
	"context"
	"path/filepath"

	"github.com/caffeine-runtime/monoform/internal/hash"
	"github.com/caffeine-runtime/monoform/internal/jobs"
)

// HashFile computes checksums as a background job (result: algo -> hex).
func (a *App) HashFile(path string, algos []string) string {
	return a.Jobs.Start("hash", "Hashing "+filepath.Base(path), func(ctx context.Context, r *jobs.Reporter) (any, error) {
		return hash.File(ctx, path, algos, func(done, total int64) { r.Set(done, total, "") })
	})
}

// HashVerify checks a checksum file; each line's result streams as job:data.
func (a *App) HashVerify(path string) string {
	return a.Jobs.Start("verify", "Verifying "+filepath.Base(path), func(ctx context.Context, r *jobs.Reporter) (any, error) {
		return hash.Verify(ctx, path, func(res hash.Result) { r.Send(res) }, func(done, total int64) { r.Set(done, total, "") })
	})
}
