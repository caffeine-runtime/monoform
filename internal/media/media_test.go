package media

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServe(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "song (1).mp3")
	os.WriteFile(p, []byte("0123456789"), 0o644)
	other := filepath.Join(dir, "secret.txt")
	os.WriteFile(other, []byte("secret"), 0o644)

	s := New("wails://wails")
	url, err := s.Register(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(url, "http://127.0.0.1:") || !strings.HasSuffix(url, "/song__1_.mp3") {
		t.Fatalf("url %s", url)
	}
	get := func(u string, hdr map[string]string) *http.Response {
		req, _ := http.NewRequest("GET", u, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	res := get(url, map[string]string{"Range": "bytes=2-5", "Origin": "wails://wails"})
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 206 || string(body) != "2345" || res.Header.Get("Content-Type") != "audio/mpeg" || res.Header.Get("Access-Control-Allow-Origin") != "wails://wails" {
		t.Fatalf("range: %d %q %v", res.StatusCode, body, res.Header)
	}
	if res := get(url, map[string]string{"Origin": "https://evil.example"}); res.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Error("foreign origin got CORS access")
	}
	base := url[:strings.Index(url, "/m/")]
	for _, u := range []string{base + "/m/0123456789abcdef0123456789abcdef/x.mp3", base + "/" + other, base + "/m/../" + other} {
		if res := get(u, nil); res.StatusCode != 404 {
			t.Errorf("%s: %d", u, res.StatusCode)
		}
	}
	// Another Host header (DNS rebinding) is refused.
	req, _ := http.NewRequest("GET", url, nil)
	req.Host = "attacker.example:80"
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != 403 {
		t.Errorf("foreign host: %d", res.StatusCode)
	}
	s.Release(url)
	if res := get(url, nil); res.StatusCode != 404 {
		t.Errorf("released file still served: %d", res.StatusCode)
	}
}
