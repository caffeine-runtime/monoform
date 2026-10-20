// Package media serves audio and video files to the webview's <audio> and
// <video> elements over loopback HTTP.
//
// Why: media elements can't load from the app's custom wails:// scheme on
// WebKitGTK (they fail with MEDIA_ERR_SRC_NOT_SUPPORTED) and WKWebView has the
// same limitation, while blob: URLs would need the whole file in memory.
// The server binds 127.0.0.1 only, on a random port, starts on first use,
// and serves nothing but files a tab registered — each under an unguessable
// per-file token, read-only, with Range support for seeking.
package media

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

// Server is the loopback media server.
type Server struct {
	mu      sync.Mutex
	ln      net.Listener
	base    string
	files   map[string]string // token -> absolute path
	origins []string          // page origins allowed to read media with CORS (for WebAudio)
}

// New returns a server that starts listening on first Register.
func New(origins ...string) *Server {
	return &Server{files: map[string]string{}, origins: origins}
}

func (s *Server) start() error {
	if s.ln != nil {
		return nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	s.ln = ln
	s.base = "http://" + ln.Addr().String()
	srv := &http.Server{Handler: s, ReadHeaderTimeout: 10 * time.Second}
	go srv.Serve(ln)
	return nil
}

// Register makes a file playable and returns its URL.
func (s *Server) Register(p string) (string, error) {
	st, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	if st.IsDir() {
		return "", errors.New("not a file")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.start(); err != nil {
		return "", err
	}
	b := make([]byte, 16)
	rand.Read(b)
	tok := hex.EncodeToString(b)
	s.files[tok] = p
	// The file name at the end lets GStreamer & co. guess the type.
	return s.base + "/m/" + tok + "/" + urlName(p), nil
}

// Release forgets a URL returned by Register.
func (s *Server) Release(url string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if tok := tokenOf(strings.TrimPrefix(url, s.base)); tok != "" {
		delete(s.files, tok)
	}
}

func urlName(p string) string {
	name := path.Base(strings.ReplaceAll(p, "\\", "/"))
	var b strings.Builder
	for _, r := range name {
		if r < 128 && (r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("._-", r)) {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	return b.String()
}

// tokenOf extracts the token from "/m/<token>/<name>".
func tokenOf(p string) string {
	rest, ok := strings.CutPrefix(p, "/m/")
	if !ok {
		return ""
	}
	tok, _, _ := strings.Cut(rest, "/")
	if len(tok) != 32 {
		return ""
	}
	return tok
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Reject other hosts (DNS rebinding) and anything but reads.
	if r.Host != strings.TrimPrefix(s.base, "http://") || (r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if o := r.Header.Get("Origin"); o != "" {
		for _, allowed := range s.origins {
			if o == allowed {
				w.Header().Set("Access-Control-Allow-Origin", o)
				w.Header().Set("Access-Control-Allow-Headers", "Range")
				w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
				w.Header().Set("Vary", "Origin")
			}
		}
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.mu.Lock()
	p := s.files[tokenOf(r.URL.Path)]
	s.mu.Unlock()
	if p == "" {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if ct := contentType(p); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeContent(w, r, "", st.ModTime(), f)
}

var types = map[string]string{
	".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
	".opus": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".weba": "audio/webm", ".mka": "audio/x-matroska", ".aif": "audio/aiff", ".aiff": "audio/aiff",
	".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
	".ogv": "video/ogg", ".avi": "video/x-msvideo",
}

func contentType(p string) string {
	return types[strings.ToLower(path.Ext(strings.ReplaceAll(p, "\\", "/")))]
}
