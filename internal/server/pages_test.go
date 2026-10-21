package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPages(t *testing.T) {
	base := t.TempDir()
	site := filepath.Join(base, "site")
	os.MkdirAll(filepath.Join(site, "img"), 0o755)
	os.WriteFile(filepath.Join(site, "img", "a.png"), []byte("\x89PNG"), 0o644)
	os.WriteFile(filepath.Join(site, "style.css"), []byte("body{}"), 0o644)
	os.WriteFile(filepath.Join(base, "secret.txt"), []byte("secret"), 0o644)
	os.Symlink(filepath.Join(base, "secret.txt"), filepath.Join(site, "link.txt"))

	s := New("session")
	tok, err := s.PageRoot(site)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := s.PageRoot(site + "/"); again != tok {
		t.Fatal("token not reused for the same folder")
	}
	get := func(method, p string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.Middleware(http.NotFoundHandler()).ServeHTTP(rec, httptest.NewRequest(method, p, nil))
		return rec
	}
	if r := get("GET", PagePrefix+tok+"/img/a.png"); r.Code != 200 || r.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("file in folder: %d %s", r.Code, r.Header().Get("Content-Type"))
	}
	os.WriteFile(filepath.Join(site, "next.html"), []byte("<p>next</p>"), 0o644)
	if r := get("GET", PagePrefix+tok+"/next.html"); r.Code != 200 || !strings.Contains(r.Header().Get("Content-Security-Policy"), "connect-src 'none'") {
		t.Fatalf("linked page without CSP: %d %q", r.Code, r.Header().Get("Content-Security-Policy"))
	}
	if r := get("GET", PagePrefix+tok+"/style.css"); r.Code != 200 || r.Body.String() != "body{}" || !strings.HasPrefix(r.Header().Get("Content-Type"), "text/css") {
		t.Fatalf("css: %d", r.Code)
	}
	for _, bad := range []string{"/../secret.txt", "/%2e%2e/secret.txt", "/link.txt", "/img/../../secret.txt"} {
		if r := get("GET", PagePrefix+tok+bad); r.Code == 200 {
			t.Fatalf("%s escaped the folder: %q", bad, r.Body.String())
		}
	}
	if r := get("GET", PagePrefix+"wrongtoken/style.css"); r.Code != 403 {
		t.Fatalf("wrong token: %d", r.Code)
	}
	if r := get("GET", PagePrefix+"session/style.css"); r.Code != 403 {
		t.Fatalf("session token must not open pages: %d", r.Code)
	}
	if r := get("POST", PagePrefix+tok+"/style.css"); r.Code != 405 {
		t.Fatalf("POST: %d", r.Code)
	}
	// A page token is not a session token.
	if r := get("GET", "/__mf/file?t="+tok+"&path="+filepath.Join(base, "secret.txt")); r.Code != 403 {
		t.Fatalf("page token opened /__mf/file: %d", r.Code)
	}
}
