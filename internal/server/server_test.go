package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func do(t *testing.T, s *Server, method, path string, q url.Values, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path+"?"+q.Encode(), rd)
	rec := httptest.NewRecorder()
	s.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	return rec
}

func TestTokenRequired(t *testing.T) {
	s := New("secret")
	rec := do(t, s, "GET", "/__hia/ping", url.Values{"t": {"wrong"}}, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("code = %d", rec.Code)
	}
	rec = do(t, s, "GET", "/__hia/ping", url.Values{"t": {"secret"}}, "")
	if rec.Code != 200 {
		t.Fatalf("code = %d", rec.Code)
	}
	// Non-/__hia paths fall through to the asset server.
	rec = do(t, s, "GET", "/index.html", url.Values{}, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("fallthrough code = %d", rec.Code)
	}
}

func TestFileAndRange(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.txt")
	os.WriteFile(p, []byte("0123456789"), 0o644)
	s := New("k")
	rec := do(t, s, "GET", "/__hia/file", url.Values{"t": {"k"}, "path": {p}}, "")
	if rec.Code != 200 || rec.Body.String() != "0123456789" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest("GET", "/__hia/file?"+url.Values{"t": {"k"}, "path": {p}}.Encode(), nil)
	req.Header.Set("Range", "bytes=2-4")
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusPartialContent || rr.Body.String() != "234" {
		t.Fatalf("range got %d %q", rr.Code, rr.Body.String())
	}
	rec = do(t, s, "GET", "/__hia/file", url.Values{"t": {"k"}, "path": {filepath.Join(dir, "missing")}}, "")
	if rec.Code != 404 {
		t.Fatalf("missing code = %d", rec.Code)
	}
	rec = do(t, s, "GET", "/__hia/file", url.Values{"t": {"k"}, "path": {"relative.txt"}}, "")
	if rec.Code != 400 {
		t.Fatalf("relative code = %d", rec.Code)
	}
}

func TestSave(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "out.txt")
	s := New("k")
	var wrote string
	s.OnWrite = func(path string) { wrote = path }
	rec := do(t, s, "POST", "/__hia/save", url.Values{"t": {"k"}, "path": {p}}, "line1\r\nline2")
	if rec.Code != 200 {
		t.Fatalf("code = %d %s", rec.Code, rec.Body.String())
	}
	got, _ := os.ReadFile(p)
	if string(got) != "line1\r\nline2" || wrote != p {
		t.Fatalf("saved %q, wrote=%q", got, wrote)
	}
	var e map[string]any
	json.Unmarshal(rec.Body.Bytes(), &e)
	if e["size"].(float64) != 12 {
		t.Fatalf("entry = %v", e)
	}
}

func TestAsset(t *testing.T) {
	dir := t.TempDir()
	note := filepath.Join(dir, "notes", "day.md")
	os.MkdirAll(filepath.Dir(note), 0o755)
	s := New("k")
	q := url.Values{"t": {"k"}, "note": {note}, "name": {"../../Screen Shot 1.png"}}
	rec := do(t, s, "POST", "/__hia/asset", q, "PNGDATA")
	if rec.Code != 200 {
		t.Fatalf("code = %d %s", rec.Code, rec.Body.String())
	}
	var res AssetResult
	json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Rel != "assets/Screen-Shot-1.png" {
		t.Fatalf("rel = %q", res.Rel)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "notes", "assets", "Screen-Shot-1.png")); string(b) != "PNGDATA" {
		t.Fatal("asset not written")
	}
	// Same name again gets a suffix instead of overwriting.
	rec = do(t, s, "POST", "/__hia/asset", q, "OTHER")
	json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Rel != "assets/Screen-Shot-1-2.png" {
		t.Fatalf("rel = %q", res.Rel)
	}
}

func TestSanitizeName(t *testing.T) {
	cases := map[string]string{
		"../../etc/passwd": "passwd",
		"C:\\x\\a b.png":   "a-b.png",
		"...":              "image",
		"zdjęcie.jpg":      "zdjęcie.jpg",
	}
	for in, want := range cases {
		if got := SanitizeName(in); got != want {
			t.Errorf("SanitizeName(%q) = %q, want %q", in, got, want)
		}
	}
}
