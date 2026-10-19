package server

import (
	"crypto/subtle"
	"errors"
	iofs "io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Pages serves the folder of an HTML file to its sandboxed preview, so
// relative images, styles and scripts load. Each folder gets its own
// read-only token, separate from the session token: a page (even one whose
// scripts the user allowed) can read files under its folder and nothing
// else, and can't use any other route.
const PagePrefix = Prefix + "page/"

type pageRoots struct {
	mu    sync.Mutex
	roots map[string]string // token → folder
	byDir map[string]string // folder → token
	// Served paths, recorded only when RecordPages is set (self-tests).
	served []string
}

// RecordPages makes the page route remember what it served (self-tests).
var RecordPages = false

// ServedPages returns and clears the recorded page-route paths.
func (s *Server) ServedPages() []string {
	s.pages.mu.Lock()
	defer s.pages.mu.Unlock()
	out := s.pages.served
	s.pages.served = nil
	return out
}

// PageRoot returns the token that serves dir (creating it once).
func (s *Server) PageRoot(dir string) (string, error) {
	dir = filepath.Clean(dir)
	st, err := os.Stat(dir)
	if err != nil {
		return "", err
	}
	if !st.IsDir() {
		return "", errors.New("not a folder")
	}
	s.pages.mu.Lock()
	defer s.pages.mu.Unlock()
	if s.pages.roots == nil {
		s.pages.roots = map[string]string{}
		s.pages.byDir = map[string]string{}
	}
	if t, ok := s.pages.byDir[dir]; ok {
		return t, nil
	}
	t := NewToken()
	s.pages.roots[t] = dir
	s.pages.byDir[dir] = t
	return t, nil
}

func (s *Server) pageDir(token string) (string, bool) {
	s.pages.mu.Lock()
	defer s.pages.mu.Unlock()
	for t, d := range s.pages.roots {
		if subtle.ConstantTimeCompare([]byte(t), []byte(token)) == 1 {
			return d, true
		}
	}
	return "", false
}

// servePage handles GET /__hia/page/<token>/<relative path>.
func (s *Server) servePage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "read-only", http.StatusMethodNotAllowed)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, PagePrefix)
	token, rel, _ := strings.Cut(rest, "/")
	dir, ok := s.pageDir(token)
	if !ok {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	rel = path.Clean("/" + rel)[1:]
	if rel == "" {
		http.NotFound(w, r)
		return
	}
	// os.Root keeps the lookup inside the folder, symlinks included.
	root, err := os.OpenRoot(dir)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer root.Close()
	f, err := root.Open(filepath.FromSlash(rel))
	if err != nil {
		if errors.Is(err, iofs.ErrNotExist) {
			http.NotFound(w, r)
		} else {
			http.Error(w, "forbidden", http.StatusForbidden)
		}
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	if RecordPages {
		s.pages.mu.Lock()
		s.pages.served = append(s.pages.served, rel)
		s.pages.mu.Unlock()
	}
	h := w.Header()
	// Web types first (the app-wide table treats .html/.css/.js as plain text).
	ct := mime.TypeByExtension(path.Ext(rel))
	if ct == "" {
		ct = ContentType(rel)
	}
	if strings.HasPrefix(ct, "text/html") || strings.HasSuffix(rel, ".svg") {
		// Pages reached by following a link inside the preview: same rules as
		// the preview (no remote content, no network from scripts).
		h.Set("Content-Security-Policy", "default-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'")
	}
	h.Set("Content-Type", ct)
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", st.ModTime().Truncate(time.Second), f)
}
