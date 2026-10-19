package server

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/caffeine-runtime/hold-it-all/internal/fs"
)

// Chunked uploads: large saves are sent as several small POSTs into a temp
// file that is atomically renamed over the target on commit. WebKitGTK copies
// request bodies on its main thread, so one 50 MB POST freezes the UI while
// 4 MB pieces don't.

const uploadTTL = 10 * time.Minute

type upload struct {
	f       *fs.AtomicFile // plain uploads: the temp file next to the target
	raw     *os.File       // transformed uploads: staging file in the temp dir
	query   url.Values
	path    string
	written int64
	touched time.Time
	mu      sync.Mutex
}

type uploads struct {
	mu   sync.Mutex
	seq  int
	open map[string]*upload
}

func (s *Server) registerUploads() {
	u := &uploads{open: map[string]*upload{}}
	s.mux.HandleFunc("POST /__hia/upload/begin", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Query().Get("path")
		if p == "" || !filepath.IsAbs(p) {
			Error(w, http.StatusBadRequest, errors.New("absolute path required"))
			return
		}
		q := r.URL.Query()
		up := &upload{path: p, query: q, touched: time.Now()}
		if q.Get("transform") != "" {
			if _, err := s.transform(q); err != nil {
				Error(w, http.StatusBadRequest, err)
				return
			}
			raw, err := os.CreateTemp("", "hia-upload-*")
			if err != nil {
				Error(w, StatusFor(err), err)
				return
			}
			up.raw = raw
		} else {
			f, err := fs.CreateAtomic(p)
			if err != nil {
				Error(w, StatusFor(err), err)
				return
			}
			up.f = f
		}
		u.mu.Lock()
		u.expire()
		u.seq++
		id := fmt.Sprintf("u%d", u.seq)
		u.open[id] = up
		u.mu.Unlock()
		JSON(w, map[string]string{"id": id})
	})
	s.mux.HandleFunc("POST /__hia/upload/chunk", func(w http.ResponseWriter, r *http.Request) {
		up := u.get(r.URL.Query().Get("id"))
		if up == nil {
			Error(w, http.StatusNotFound, errors.New("unknown upload"))
			return
		}
		up.mu.Lock()
		defer up.mu.Unlock()
		n, err := io.Copy(up.writer(), http.MaxBytesReader(w, r.Body, 64<<20))
		up.written += n
		up.touched = time.Now()
		if err != nil {
			Error(w, StatusFor(err), err)
			return
		}
		JSON(w, map[string]int64{"written": up.written})
	})
	s.mux.HandleFunc("POST /__hia/upload/commit", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		up := u.take(id)
		if up == nil {
			Error(w, http.StatusNotFound, errors.New("unknown upload"))
			return
		}
		up.mu.Lock()
		defer up.mu.Unlock()
		if err := s.commit(up); err != nil {
			Error(w, StatusFor(err), err)
			return
		}
		s.wrote(up.path)
		e, err := fs.Stat(up.path)
		if err != nil {
			Error(w, StatusFor(err), err)
			return
		}
		JSON(w, e)
	})
	s.mux.HandleFunc("POST /__hia/upload/abort", func(w http.ResponseWriter, r *http.Request) {
		if up := u.take(r.URL.Query().Get("id")); up != nil {
			up.mu.Lock()
			up.abort()
			up.mu.Unlock()
		}
		JSON(w, map[string]bool{"ok": true})
	})
}

func (u *uploads) get(id string) *upload {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.open[id]
}

func (u *uploads) take(id string) *upload {
	u.mu.Lock()
	defer u.mu.Unlock()
	up := u.open[id]
	delete(u.open, id)
	return up
}

// expire aborts uploads abandoned by the frontend; must hold u.mu.
func (u *uploads) expire() {
	for id, up := range u.open {
		if time.Since(up.touched) > uploadTTL {
			up.abort()
			delete(u.open, id)
		}
	}
}

func (up *upload) writer() io.Writer {
	if up.raw != nil {
		return up.raw
	}
	return up.f
}

func (up *upload) abort() {
	if up.raw != nil {
		up.raw.Close()
		os.Remove(up.raw.Name())
		return
	}
	up.f.Abort()
}

// commit finishes an upload: plain uploads rename their temp file; transformed
// uploads run the transform from the staging file into an atomic write.
func (s *Server) commit(up *upload) error {
	if up.raw == nil {
		return up.f.Commit()
	}
	defer func() {
		up.raw.Close()
		os.Remove(up.raw.Name())
	}()
	if _, err := up.raw.Seek(0, io.SeekStart); err != nil {
		return err
	}
	tf, err := s.transform(up.query)
	if err != nil {
		return err
	}
	return fs.AtomicWrite(up.path, func(w io.Writer) error { return tf(w, up.raw, up.query) })
}
