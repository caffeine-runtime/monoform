// Package update finds a newer release of Monoform on GitHub, downloads the
// package for this system (checked against the release's SHA256SUMS) and puts
// it in place of the running copy (see apply*.go). The check is one request
// to GitHub's public API with no identifying data; users can turn it off.
package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Repo is where releases are published.
const Repo = "caffeine-runtime/monoform"

// API is GitHub's REST API (tests point it elsewhere).
var API = "https://api.github.com"

var client = &http.Client{Timeout: 30 * time.Second}

// Release is a published version and the package for this system.
type Release struct {
	Version string `json:"version"` // "1.2.0" (tag without "v")
	Notes   string `json:"notes"`   // the release notes (Markdown)
	URL     string `json:"url"`     // the release page
	// Asset is the package for this system: name, download URL and size.
	Asset     string `json:"asset"`
	AssetURL  string `json:"assetUrl"`
	AssetSize int64  `json:"assetSize"`
	SumsURL   string `json:"sumsUrl"` // SHA256SUMS, if published
}

// AssetName is the release file for an OS (installed: the installer on Windows).
func AssetName(goos string, portable bool) string {
	switch goos {
	case "windows":
		if portable {
			return "monoform-windows-amd64-portable.zip"
		}
		return "monoform-amd64-installer.exe"
	case "darwin":
		return "monoform-macos-universal.zip"
	default:
		return "monoform-linux-amd64.tar.gz"
	}
}

type ghRelease struct {
	TagName    string `json:"tag_name"`
	Body       string `json:"body"`
	HTMLURL    string `json:"html_url"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
		Size int64  `json:"size"`
	} `json:"assets"`
}

// Latest returns the newest published (non-pre-release) version with its package for goos.
func Latest(ctx context.Context, goos string, portable bool) (Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, API+"/repos/"+Repo+"/releases/latest", nil)
	if err != nil {
		return Release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Monoform-update-check")
	resp, err := client.Do(req)
	if err != nil {
		return Release{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return Release{}, errors.New("no published release")
	}
	if resp.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("GitHub answered %s", resp.Status)
	}
	var gr ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&gr); err != nil {
		return Release{}, err
	}
	if gr.Draft || gr.Prerelease {
		return Release{}, errors.New("no published release")
	}
	r := Release{Version: strings.TrimPrefix(gr.TagName, "v"), Notes: gr.Body, URL: gr.HTMLURL}
	want := AssetName(goos, portable)
	for _, a := range gr.Assets {
		switch a.Name {
		case want:
			r.Asset, r.AssetURL, r.AssetSize = a.Name, a.URL, a.Size
		case "SHA256SUMS":
			r.SumsURL = a.URL
		}
	}
	return r, nil
}

// Newer reports whether version a is newer than b (semantic versions; a
// pre-release is older than its release; "-dev" builds never count as newer).
func Newer(a, b string) bool {
	return compare(a, b) > 0
}

func compare(a, b string) int {
	pa, preA := split(a)
	pb, preB := split(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			if pa[i] > pb[i] {
				return 1
			}
			return -1
		}
	}
	switch {
	case preA == preB:
		return 0
	case preA == "":
		return 1
	case preB == "":
		return -1
	}
	return comparePre(preA, preB)
}

func split(v string) ([3]int, string) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexByte(v, '+'); i >= 0 {
		v = v[:i]
	}
	pre := ""
	if i := strings.IndexByte(v, '-'); i >= 0 {
		v, pre = v[:i], v[i+1:]
	}
	var n [3]int
	for i, p := range strings.SplitN(v, ".", 3) {
		n[i], _ = strconv.Atoi(p)
	}
	return n, pre
}

// comparePre orders pre-release labels ("beta.2" < "beta.10" < "rc.1").
func comparePre(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(as) && i < len(bs); i++ {
		x, errX := strconv.Atoi(as[i])
		y, errY := strconv.Atoi(bs[i])
		switch {
		case errX == nil && errY == nil:
			if x != y {
				if x > y {
					return 1
				}
				return -1
			}
		case errX == nil:
			return -1
		case errY == nil:
			return 1
		default:
			if c := strings.Compare(as[i], bs[i]); c != 0 {
				return c
			}
		}
	}
	return len(as) - len(bs)
}

// IsDev reports a local build (no release version stamped in): it isn't updated.
func IsDev(v string) bool {
	return v == "" || strings.HasSuffix(v, "-dev")
}

// Download fetches the release's package into dir and checks it against
// SHA256SUMS. progress gets (done, total) bytes.
func Download(ctx context.Context, r Release, dir string, progress func(done, total int64)) (string, error) {
	if r.AssetURL == "" {
		return "", fmt.Errorf("version %s has no package for this system", r.Version)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	var want string
	if r.SumsURL != "" {
		sums, err := fetch(ctx, r.SumsURL, 1<<20)
		if err != nil {
			return "", fmt.Errorf("reading SHA256SUMS: %w", err)
		}
		want = sumFor(string(sums), r.Asset)
		if want == "" {
			return "", fmt.Errorf("SHA256SUMS doesn't list %s", r.Asset)
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.AssetURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Monoform-update")
	dl := &http.Client{} // no overall timeout: packages are large; ctx cancels
	resp, err := dl.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download: %s", resp.Status)
	}
	total := resp.ContentLength
	if total <= 0 {
		total = r.AssetSize
	}
	dst := filepath.Join(dir, r.Asset)
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	var done int64
	buf := make([]byte, 256<<10)
	last := time.Time{}
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := f.Write(buf[:n]); err != nil {
				f.Close()
				os.Remove(tmp)
				return "", err
			}
			h.Write(buf[:n])
			done += int64(n)
			if progress != nil && time.Since(last) > 100*time.Millisecond {
				last = time.Now()
				progress(done, total)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			os.Remove(tmp)
			return "", rerr
		}
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return "", err
	}
	if progress != nil {
		progress(done, total)
	}
	if got := hex.EncodeToString(h.Sum(nil)); want != "" && !strings.EqualFold(got, want) {
		os.Remove(tmp)
		return "", fmt.Errorf("the download is damaged (SHA-256 %s, expected %s)", got[:12], want[:12])
	}
	if err := os.Rename(tmp, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func fetch(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Monoform-update")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New(resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}

// sumFor finds name's checksum in a SHA256SUMS file ("<hex>  <name>" or "<hex> *<name>").
func sumFor(sums, name string) string {
	for _, line := range strings.Split(sums, "\n") {
		f := strings.Fields(line)
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name && len(f[0]) == 64 {
			return f[0]
		}
	}
	return ""
}

// GOOS is runtime.GOOS (a variable so tests can pretend).
var GOOS = runtime.GOOS
