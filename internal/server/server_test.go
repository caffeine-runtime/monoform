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
	rec := do(t, s, "GET", "/__mf/ping", url.Values{"t": {"wrong"}}, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("code = %d", rec.Code)
	}
	rec = do(t, s, "GET", "/__mf/ping", url.Values{"t": {"secret"}}, "")
	if rec.Code != 200 {
		t.Fatalf("code = %d", rec.Code)
	}
	// Non-/__mf paths fall through to the asset server.
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
	rec := do(t, s, "GET", "/__mf/file", url.Values{"t": {"k"}, "path": {p}}, "")
	if rec.Code != 200 || rec.Body.String() != "0123456789" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest("GET", "/__mf/file?"+url.Values{"t": {"k"}, "path": {p}}.Encode(), nil)
	req.Header.Set("Range", "bytes=2-4")
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusPartialContent || rr.Body.String() != "234" {
		t.Fatalf("range got %d %q", rr.Code, rr.Body.String())
	}
	rec = do(t, s, "GET", "/__mf/file", url.Values{"t": {"k"}, "path": {filepath.Join(dir, "missing")}}, "")
	if rec.Code != 404 {
		t.Fatalf("missing code = %d", rec.Code)
	}
	rec = do(t, s, "GET", "/__mf/file", url.Values{"t": {"k"}, "path": {"relative.txt"}}, "")
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
	rec := do(t, s, "POST", "/__mf/save", url.Values{"t": {"k"}, "path": {p}}, "line1\r\nline2")
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
	rec := do(t, s, "POST", "/__mf/asset", q, "PNGDATA")
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
	rec = do(t, s, "POST", "/__mf/asset", q, "OTHER")
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

func TestChunkedUpload(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "big.txt")
	os.WriteFile(p, []byte("old"), 0o644)
	s := New("k")
	rec := do(t, s, "POST", "/__mf/upload/begin", url.Values{"t": {"k"}, "path": {p}}, "")
	var begin map[string]string
	json.Unmarshal(rec.Body.Bytes(), &begin)
	id := begin["id"]
	if id == "" {
		t.Fatalf("begin: %s", rec.Body.String())
	}
	for _, part := range []string{"aaa", "bbb", "c"} {
		rec = do(t, s, "POST", "/__mf/upload/chunk", url.Values{"t": {"k"}, "id": {id}}, part)
		if rec.Code != 200 {
			t.Fatalf("chunk: %d %s", rec.Code, rec.Body.String())
		}
	}
	if got, _ := os.ReadFile(p); string(got) != "old" {
		t.Fatal("target replaced before commit")
	}
	rec = do(t, s, "POST", "/__mf/upload/commit", url.Values{"t": {"k"}, "id": {id}}, "")
	if rec.Code != 200 {
		t.Fatalf("commit: %d %s", rec.Code, rec.Body.String())
	}
	if got, _ := os.ReadFile(p); string(got) != "aaabbbc" {
		t.Fatalf("got %q", got)
	}
	rec = do(t, s, "POST", "/__mf/upload/chunk", url.Values{"t": {"k"}, "id": {id}}, "x")
	if rec.Code != 404 {
		t.Fatal("chunk after commit accepted")
	}
	// Abort leaves the file alone and removes the temp file.
	rec = do(t, s, "POST", "/__mf/upload/begin", url.Values{"t": {"k"}, "path": {p}}, "")
	json.Unmarshal(rec.Body.Bytes(), &begin)
	do(t, s, "POST", "/__mf/upload/chunk", url.Values{"t": {"k"}, "id": {begin["id"]}}, "zzz")
	do(t, s, "POST", "/__mf/upload/abort", url.Values{"t": {"k"}, "id": {begin["id"]}}, "")
	if got, _ := os.ReadFile(p); string(got) != "aaabbbc" {
		t.Fatal("abort changed file")
	}
	des, _ := os.ReadDir(dir)
	if len(des) != 1 {
		t.Fatalf("leftover files: %v", des)
	}
}

func TestEmptyBodyHeader(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "e.txt")
	os.WriteFile(p, []byte("x"), 0o644)
	s := New("k")
	req := httptest.NewRequest("POST", "/__mf/save?"+url.Values{"t": {"k"}, "path": {p}}.Encode(), strings.NewReader("ignored"))
	req.Header.Set("X-Empty-Body", "1")
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if got, _ := os.ReadFile(p); rr.Code != 200 || len(got) != 0 {
		t.Fatalf("code %d content %q", rr.Code, got)
	}
}

func TestTransforms(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "up.txt")
	s := New("k")
	s.Transforms["upper"] = func(w io.Writer, r io.Reader, q url.Values) error {
		b, err := io.ReadAll(r)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(strings.ToUpper(string(b)) + q.Get("suffix")))
		return err
	}
	rec := do(t, s, "POST", "/__mf/save", url.Values{"t": {"k"}, "path": {p}, "transform": {"upper"}, "suffix": {"!"}}, "abc")
	if got, _ := os.ReadFile(p); rec.Code != 200 || string(got) != "ABC!" {
		t.Fatalf("single: %d %q", rec.Code, got)
	}
	rec = do(t, s, "POST", "/__mf/upload/begin", url.Values{"t": {"k"}, "path": {p}, "transform": {"upper"}}, "")
	var begin map[string]string
	json.Unmarshal(rec.Body.Bytes(), &begin)
	do(t, s, "POST", "/__mf/upload/chunk", url.Values{"t": {"k"}, "id": {begin["id"]}}, "hello ")
	do(t, s, "POST", "/__mf/upload/chunk", url.Values{"t": {"k"}, "id": {begin["id"]}}, "world")
	rec = do(t, s, "POST", "/__mf/upload/commit", url.Values{"t": {"k"}, "id": {begin["id"]}}, "")
	if got, _ := os.ReadFile(p); rec.Code != 200 || string(got) != "HELLO WORLD" {
		t.Fatalf("chunked: %d %q %s", rec.Code, got, rec.Body.String())
	}
	rec = do(t, s, "POST", "/__mf/save", url.Values{"t": {"k"}, "path": {p}, "transform": {"nope"}}, "x")
	if rec.Code != 400 {
		t.Fatalf("unknown transform: %d", rec.Code)
	}
	if got, _ := os.ReadFile(p); string(got) != "HELLO WORLD" {
		t.Fatal("file changed by failed transform")
	}
}
