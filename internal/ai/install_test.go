package ai

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caffeine-runtime/monoform/internal/download"
)

// Two packs installing at once fetch the shared runtime once: the second
// waits for it, then counts it as done; a cancelled wait returns at once.
func TestInstallTogether(t *testing.T) {
	if !Supported() {
		t.Skip("no runtime for this platform")
	}
	var mu sync.Mutex
	fetched := map[string]int{}
	var running, most atomic.Int32
	present = func(dst string, f download.File) bool {
		_, err := os.Stat(dst)
		return err == nil
	}
	fetch = func(ctx context.Context, _ *http.Client, dst string, f download.File, progress func(int64)) error {
		if n := running.Add(1); n > most.Load() {
			most.Store(n)
		}
		defer running.Add(-1)
		mu.Lock()
		fetched[filepath.Base(dst)]++
		mu.Unlock()
		select {
		case <-time.After(60 * time.Millisecond):
		case <-ctx.Done():
			return ctx.Err()
		}
		progress(f.Transfer())
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return os.WriteFile(dst, nil, 0o644)
	}
	defer func() { present, fetch = download.Present, download.Fetch }()

	s := Store{Dir: t.TempDir()}
	a := Pack{ID: "a", Files: []PackFile{{Name: "a.onnx", File: download.File{Size: 10}}}}
	b := Pack{ID: "b", Files: []PackFile{{Name: "b.onnx", File: download.File{Size: 20}}}}
	var wg sync.WaitGroup
	var last [2]struct{ done, total int64 }
	for i, p := range []Pack{a, b} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.Install(context.Background(), nil, p, func(d, n int64) { last[i].done, last[i].total = d, n }); err != nil {
				t.Errorf("%s: %v", p.ID, err)
			}
		}()
	}
	wg.Wait()
	r, _ := platformRuntime()
	if fetched[r.name] != 1 {
		t.Errorf("runtime fetched %d times, want 1 (%v)", fetched[r.name], fetched)
	}
	if fetched["a.onnx"] != 1 || fetched["b.onnx"] != 1 {
		t.Errorf("model files: %v", fetched)
	}
	if most.Load() < 2 {
		t.Errorf("the two installs never downloaded at the same time")
	}
	for i, l := range last {
		if l.done != l.total || l.total == 0 {
			t.Errorf("install %d ended at %d of %d", i, l.done, l.total)
		}
	}

	// Waiting for a file another install holds ends when cancelled.
	unlock, err := lockFile(context.Background(), "x")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := lockFile(ctx, "x"); err == nil {
		t.Error("a cancelled wait got the lock")
	}
	unlock()
}
