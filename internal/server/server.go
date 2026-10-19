// Package server implements the binary data channel between the webview and
// Go. Wails bindings marshal everything as JSON, which is far too slow for a
// 50 MB log or a PDF, so file contents travel over plain HTTP requests that
// the Wails asset server routes to this handler (/__hia/...).
//
// Every request must carry the per-launch token (?t=...). Only our own
// frontend knows it, so content rendered from user files (markdown, SVG) can't
// reach the file system through this channel.
package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	iofs "io/fs"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/caffeine-runtime/hold-it-all/internal/filetype"
	"github.com/caffeine-runtime/hold-it-all/internal/fs"
)

const Prefix = "/__hia/"

// MaxUpload bounds request bodies (a saved file). Large enough for any
// realistic document or image, small enough to stop runaway memory use.
const MaxUpload = 4 << 30

// Transform converts uploaded bytes before they are written (e.g. PNG from a
// canvas re-encoded as JPEG). Registered by name; a save request selects one
// with ?transform=<name>; the other query parameters are passed through.
type Transform func(w io.Writer, r io.Reader, q url.Values) error

type Server struct {
	token string
	mux   *http.ServeMux
	// Transforms available to save/upload requests.
	Transforms map[string]Transform
	// OnWrite is called after a successful save (watcher self-write suppression).
	OnWrite func(path string)
	pages   pageRoots
}

func NewToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func New(token string) *Server {
	s := &Server{token: token, mux: http.NewServeMux(), Transforms: map[string]Transform{}}
	s.mux.HandleFunc("GET /__hia/file", s.handleFile)
	s.mux.HandleFunc("POST /__hia/save", s.handleSave)
	s.mux.HandleFunc("POST /__hia/asset", s.handleAsset)
	s.registerUploads()
	s.mux.HandleFunc("GET /__hia/ping", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	return s
}

// Handle registers an additional route (pattern like "POST /__hia/pdf").
func (s *Server) Handle(pattern string, h http.HandlerFunc) { s.mux.HandleFunc(pattern, h) }

func (s *Server) Token() string { return s.token }

// Middleware routes /__hia/ requests to the server and everything else to next.
func (s *Server) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, Prefix) {
			s.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, PagePrefix) {
		s.servePage(w, r) // scoped page tokens, see pages.go
		return
	}
	tok := r.URL.Query().Get("t")
	if subtle.ConstantTimeCompare([]byte(tok), []byte(s.token)) != 1 {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get("X-Empty-Body") == "1" {
		// The frontend never sends a zero-length body (WebKitGTK can't), it
		// sets this header instead.
		r.Body = http.NoBody
	}
	s.mux.ServeHTTP(w, r)
}

// Error writes a JSON error body with the given status.
func Error(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

// JSON writes v as a JSON response.
func JSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// StatusFor maps common file errors to HTTP status codes.
func StatusFor(err error) int {
	switch {
	case errors.Is(err, iofs.ErrNotExist):
		return http.StatusNotFound
	case errors.Is(err, iofs.ErrPermission):
		return http.StatusForbidden
	default:
		return http.StatusInternalServerError
	}
}

// ContentType guesses a MIME type from the file name.
func ContentType(name string) string {
	if info := filetype.ByName(name); info.Mime != "" {
		return info.Mime
	}
	if t := mime.TypeByExtension(filepath.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}

// handleFile streams a file from disk; Range requests are supported so
// pdf.js and media can fetch parts of large files.
func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" || !filepath.IsAbs(p) {
		Error(w, http.StatusBadRequest, errors.New("absolute path required"))
		return
	}
	f, err := os.Open(p)
	if err != nil {
		Error(w, StatusFor(err), err)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		Error(w, StatusFor(err), err)
		return
	}
	if st.IsDir() {
		Error(w, http.StatusBadRequest, errors.New("is a directory"))
		return
	}
	w.Header().Set("Content-Type", ContentType(p))
	w.Header().Set("X-Mod-Time", fmt.Sprint(st.ModTime().UnixMilli()))
	http.ServeContent(w, r, "", st.ModTime(), f)
}

// handleSave atomically replaces the file at ?path= with the request body.
func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" || !filepath.IsAbs(p) {
		Error(w, http.StatusBadRequest, errors.New("absolute path required"))
		return
	}
	body := http.MaxBytesReader(w, r.Body, MaxUpload)
	tf, err := s.transform(r.URL.Query())
	if err != nil {
		Error(w, http.StatusBadRequest, err)
		return
	}
	if err := fs.AtomicWrite(p, func(out io.Writer) error { return tf(out, body, r.URL.Query()) }); err != nil {
		log.Printf("save %s: %v", p, err)
		Error(w, StatusFor(err), err)
		return
	}
	s.wrote(p)
	e, err := fs.Stat(p)
	if err != nil {
		Error(w, StatusFor(err), err)
		return
	}
	JSON(w, e)
}

// transform returns the requested transform, or a plain copy.
func (s *Server) transform(q url.Values) (Transform, error) {
	name := q.Get("transform")
	if name == "" {
		return func(w io.Writer, r io.Reader, _ url.Values) error {
			_, err := io.Copy(w, r)
			return err
		}, nil
	}
	tf, ok := s.Transforms[name]
	if !ok {
		return nil, fmt.Errorf("unknown transform %q", name)
	}
	return tf, nil
}

func (s *Server) wrote(p string) {
	if s.OnWrite != nil {
		s.OnWrite(p)
	}
}

var unsafeName = regexp.MustCompile(`[^\p{L}\p{N}._-]+`)

// SanitizeName turns an arbitrary pasted file name into a safe base name.
func SanitizeName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = unsafeName.ReplaceAllString(name, "-")
	name = strings.Trim(name, ".-")
	if name == "" {
		name = "image"
	}
	if len(name) > 100 {
		ext := filepath.Ext(name)
		name = name[:100-len(ext)] + ext
	}
	return name
}

// UniquePath returns dir/name, or dir/name-2.ext etc. if that exists.
func UniquePath(dir, name string) string {
	p := filepath.Join(dir, name)
	if _, err := os.Lstat(p); errors.Is(err, iofs.ErrNotExist) {
		return p
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ {
		p = filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, i, ext))
		if _, err := os.Lstat(p); errors.Is(err, iofs.ErrNotExist) {
			return p
		}
	}
}

// AssetResult is returned when an image is pasted into a note.
type AssetResult struct {
	Path string `json:"path"` // absolute path of the written file
	Rel  string `json:"rel"`  // link relative to the note, always with forward slashes
}

// handleAsset stores a pasted/dropped image in an assets/ folder next to the
// note given by ?note= and returns the relative link to insert.
func (s *Server) handleAsset(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	note := q.Get("note")
	if note == "" || !filepath.IsAbs(note) {
		Error(w, http.StatusBadRequest, errors.New("absolute note path required"))
		return
	}
	res, err := SaveAsset(note, q.Get("name"), http.MaxBytesReader(w, r.Body, 512<<20))
	if err != nil {
		Error(w, StatusFor(err), err)
		return
	}
	s.wrote(res.Path)
	JSON(w, res)
}

// SaveAsset writes r to <dir of note>/assets/<sanitized name> without
// overwriting existing files.
func SaveAsset(note, name string, r io.Reader) (AssetResult, error) {
	dir := filepath.Join(filepath.Dir(note), "assets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return AssetResult{}, err
	}
	p := UniquePath(dir, SanitizeName(name))
	if err := fs.AtomicWriteReader(p, r); err != nil {
		return AssetResult{}, err
	}
	rel, err := filepath.Rel(filepath.Dir(note), p)
	if err != nil {
		return AssetResult{}, err
	}
	return AssetResult{Path: p, Rel: filepath.ToSlash(rel)}, nil
}
