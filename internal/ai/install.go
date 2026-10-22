package ai

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"sync"

	"github.com/caffeine-runtime/monoform/internal/download"
)

// Seams for tests.
var (
	present = download.Present
	fetch   = download.Fetch
)

// fileLocks lets several packs install at once without fetching a shared
// file (the runtime is part of every install) twice: dst → a 1-slot channel.
var fileLocks sync.Map

// lockFile waits for its turn at dst (or for ctx to end).
func lockFile(ctx context.Context, dst string) (unlock func(), err error) {
	v, _ := fileLocks.LoadOrStore(dst, make(chan struct{}, 1))
	ch := v.(chan struct{})
	select {
	case ch <- struct{}{}:
		return func() { <-ch }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

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
	var todo []job
	for _, j := range jobs {
		if !present(j.dst, j.f) {
			total += j.f.Transfer()
			todo = append(todo, j)
		}
	}
	progress(0, total)
	for _, j := range todo {
		unlock, err := lockFile(ctx, j.dst)
		if err != nil {
			return err
		}
		// Another install may have fetched it while this one waited.
		if !present(j.dst, j.f) {
			base := done
			err = fetch(ctx, client, j.dst, j.f, func(n int64) { progress(base+n, total) })
		}
		unlock()
		if err != nil {
			return err
		}
		done += j.f.Transfer()
		progress(done, total)
	}
	return nil
}
