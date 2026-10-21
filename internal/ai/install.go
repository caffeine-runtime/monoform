package ai

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"

	"github.com/caffeine-runtime/hold-it-all/internal/download"
)

// Install downloads a pack (and the runtime, if missing), verifying every
// file. Files already there are kept, so an interrupted install resumes per
// file. progress gets transferred and total bytes.
func (s Store) Install(ctx context.Context, client *http.Client, p Pack, progress func(done, total int64)) error {
	r, ok := platformRuntime()
	if !ok {
		return errors.New("this computer's system isn't supported by the models' runtime")
	}
	type job struct {
		dst string
		f   download.File
	}
	var jobs []job
	for _, f := range append([]runtimeFile{r}, runtimeNotices...) {
		jobs = append(jobs, job{filepath.Join(s.runtimeDir(), f.name), f.File})
	}
	for _, f := range p.Files {
		jobs = append(jobs, job{filepath.Join(s.packDir(p), f.Name), f.File})
	}
	var total, done int64
	for _, j := range jobs {
		if !download.Present(j.dst, j.f) {
			total += j.f.Transfer()
		}
	}
	progress(0, total)
	for _, j := range jobs {
		if download.Present(j.dst, j.f) {
			continue
		}
		base := done
		if err := download.Fetch(ctx, client, j.dst, j.f, func(n int64) { progress(base+n, total) }); err != nil {
			return err
		}
		done += j.f.Transfer()
		progress(done, total)
	}
	return nil
}
