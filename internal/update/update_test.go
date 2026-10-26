package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"1.0.1", "1.0.0", true},
		{"1.1.0", "1.0.9", true},
		{"2.0.0", "1.99.99", true},
		{"1.0.0", "1.0.0", false},
		{"1.0.0", "1.0.1", false},
		{"1.0.0", "1.0.0-beta.3", true},
		{"1.0.0-beta.10", "1.0.0-beta.9", true},
		{"1.0.0-rc.1", "1.0.0-beta.9", true},
		{"v1.2.0", "1.1.0", true},
		{"1.0.0+build.5", "1.0.0", false},
	} {
		if got := Newer(c.a, c.b); got != c.want {
			t.Errorf("Newer(%q, %q) = %v", c.a, c.b, got)
		}
	}
	if !IsDev("1.0.0-dev") || !IsDev("") || IsDev("1.0.0") {
		t.Error("IsDev")
	}
}

func sha(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

// server publishes one release with a package and SHA256SUMS (sums can be overridden).
func server(t *testing.T, pkg []byte, sums string, prerelease bool) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/" + Repo + "/releases/latest":
			fmt.Fprintf(w, `{"tag_name":"v1.2.0","body":"## New\n- things","html_url":"https://example/rel","prerelease":%v,"assets":[
				{"name":"monoform-linux-amd64.tar.gz","browser_download_url":"%[2]s/dl/linux","size":%[3]d},
				{"name":"monoform-macos-universal.zip","browser_download_url":"%[2]s/dl/mac","size":1},
				{"name":"monoform-amd64-installer.exe","browser_download_url":"%[2]s/dl/win","size":1},
				{"name":"SHA256SUMS","browser_download_url":"%[2]s/dl/sums","size":10}]}`, prerelease, srv.URL, len(pkg))
		case "/dl/linux":
			w.Write(pkg)
		case "/dl/sums":
			w.Write([]byte(sums))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestLatestAndDownload(t *testing.T) {
	pkg := []byte("package bytes")
	srv := server(t, pkg, sha(pkg)+"  monoform-linux-amd64.tar.gz\n"+strings.Repeat("0", 64)+"  other\n", false)
	API = srv.URL
	r, err := Latest(context.Background(), "linux", false)
	if err != nil {
		t.Fatal(err)
	}
	if r.Version != "1.2.0" || r.Asset != "monoform-linux-amd64.tar.gz" || r.URL != "https://example/rel" || !strings.Contains(r.Notes, "things") || r.SumsURL == "" {
		t.Fatalf("release = %+v", r)
	}
	if w, _ := Latest(context.Background(), "windows", false); w.Asset != "monoform-amd64-installer.exe" {
		t.Errorf("windows asset %q", w.Asset)
	}
	dir := t.TempDir()
	var last int64
	p, err := Download(context.Background(), r, dir, func(d, n int64) { last = d })
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); !bytes.Equal(b, pkg) || last != int64(len(pkg)) {
		t.Errorf("downloaded %q, progress %d", b, last)
	}
}

func TestDamagedDownloadIsRejected(t *testing.T) {
	pkg := []byte("package bytes")
	srv := server(t, pkg, strings.Repeat("a", 64)+"  monoform-linux-amd64.tar.gz\n", false)
	API = srv.URL
	r, err := Latest(context.Background(), "linux", false)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if _, err := Download(context.Background(), r, dir, nil); err == nil || !strings.Contains(err.Error(), "damaged") {
		t.Fatalf("err = %v", err)
	}
	if left, _ := os.ReadDir(dir); len(left) != 0 {
		t.Errorf("left %v", left)
	}
}

func TestPrereleaseIsNotOffered(t *testing.T) {
	srv := server(t, []byte("x"), "", true)
	API = srv.URL
	if _, err := Latest(context.Background(), "linux", false); err == nil {
		t.Fatal("a pre-release was offered")
	}
}

func targz(t *testing.T, files map[string]string) string {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg})
		tw.Write([]byte(body))
	}
	tw.Close()
	gz.Close()
	p := filepath.Join(t.TempDir(), "pkg.tar.gz")
	os.WriteFile(p, buf.Bytes(), 0o644)
	return p
}

func zipped(t *testing.T, name string, files map[string]string, links map[string]string) string {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for n, body := range files {
		h := &zip.FileHeader{Name: n, Method: zip.Deflate}
		h.SetMode(0o755)
		w, _ := zw.CreateHeader(h)
		w.Write([]byte(body))
	}
	for n, target := range links {
		h := &zip.FileHeader{Name: n}
		h.SetMode(os.ModeSymlink | 0o777)
		w, _ := zw.CreateHeader(h)
		w.Write([]byte(target))
	}
	zw.Close()
	p := filepath.Join(t.TempDir(), name)
	os.WriteFile(p, buf.Bytes(), 0o644)
	return p
}

func TestApplyLinuxReplacesTheRunningBinary(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "monoform")
	os.WriteFile(exe, []byte("old"), 0o755)
	cmd, err := Apply(targz(t, map[string]string{"monoform/monoform": "new", "monoform/install.sh": "#!/bin/sh"}), exe)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "new" || len(cmd) != 1 || cmd[0] != exe {
		t.Fatalf("exe %q, cmd %v", b, cmd)
	}
	if st, _ := os.Stat(exe); st.Mode().Perm()&0o100 == 0 {
		t.Error("not executable")
	}
	if b, _ := os.ReadFile(exe + ".old"); string(b) != "old" {
		t.Error("old copy kept until the next start")
	}
	AfterUpdate([]string{"--after-update=999999999"}, exe)
	if _, err := os.Stat(exe + ".old"); !os.IsNotExist(err) {
		t.Error("old copy removed after the update")
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".monoform-update-*")); len(left) != 0 {
		t.Errorf("staging left: %v", left)
	}
}

func TestApplyPortableWindows(t *testing.T) {
	defer func(g string) { GOOS = g }(GOOS)
	GOOS = "windows"
	dir := t.TempDir()
	exe := filepath.Join(dir, "monoform.exe")
	os.WriteFile(exe, []byte("old"), 0o755)
	os.WriteFile(filepath.Join(dir, "monoform-cli.exe"), []byte("old cli"), 0o755)
	if _, err := Apply(zipped(t, "monoform-windows-amd64-portable.zip", map[string]string{"monoform.exe": "new", "monoform-cli.exe": "new cli"}, nil), exe); err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(exe)
	b, _ := os.ReadFile(filepath.Join(dir, "monoform-cli.exe"))
	if string(a) != "new" || string(b) != "new cli" {
		t.Fatalf("%q %q", a, b)
	}
}

func TestApplyMacBundle(t *testing.T) {
	defer func(g string) { GOOS = g }(GOOS)
	GOOS = "darwin"
	dir := t.TempDir()
	exe := filepath.Join(dir, "Monoform.app", "Contents", "MacOS", "monoform")
	os.MkdirAll(filepath.Dir(exe), 0o755)
	os.WriteFile(exe, []byte("old"), 0o755)
	pkg := zipped(t, "monoform-macos-universal.zip",
		map[string]string{"Monoform.app/Contents/MacOS/monoform": "new", "Monoform.app/Contents/Info.plist": "plist"},
		map[string]string{"Monoform.app/Contents/Current": "MacOS"})
	cmd, err := Apply(pkg, exe)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "new" {
		t.Fatalf("exe %q", b)
	}
	if l, err := os.Readlink(filepath.Join(dir, "Monoform.app", "Contents", "Current")); err != nil || l != "MacOS" {
		t.Errorf("symlink kept: %q %v", l, err)
	}
	if strings.Join(cmd[:3], " ") != "open -n "+filepath.Join(dir, "Monoform.app") {
		t.Errorf("cmd %v", cmd)
	}
	CleanOld(exe)
	if _, err := os.Stat(filepath.Join(dir, "Monoform.app.old")); !os.IsNotExist(err) {
		t.Error("old bundle removed")
	}
}

func TestPackagesCantEscapeTheirFolder(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "monoform")
	os.WriteFile(exe, []byte("old"), 0o755)
	if _, err := Apply(targz(t, map[string]string{"../evil": "x"}), exe); err == nil {
		t.Fatal("accepted a path outside the package")
	}
	if b, _ := os.ReadFile(exe); string(b) != "old" {
		t.Error("the running copy was touched")
	}
}

// With nightlies chosen, the newest of releases and nightlies built for this
// system is offered; betas and drafts never are.
func TestLatestWithNightlies(t *testing.T) {
	rel := func(tag string, pre, draft bool, assets ...string) string {
		var as []string
		for _, a := range assets {
			as = append(as, fmt.Sprintf(`{"name":%q,"browser_download_url":"https://dl/%s/%s","size":5}`, a, tag, a))
		}
		return fmt.Sprintf(`{"tag_name":%q,"body":"notes %s","html_url":"https://rel/%s","prerelease":%v,"draft":%v,"assets":[%s]}`, tag, tag, tag, pre, draft, strings.Join(as, ","))
	}
	lin, win := "monoform-linux-amd64.tar.gz", "monoform-amd64-installer.exe"
	list := []string{
		rel("v9.0.0", false, true, lin, win),                  // draft
		rel("v1.6.0-beta.1", true, false, lin, win),           // a beta, not a nightly
		rel("v1.5.0-nightly.20261026", true, false, win),      // not built for Linux
		rel("v1.5.0-nightly.20261025", true, false, lin, win), //
		rel("v1.4.2", false, false, lin, win, "SHA256SUMS"),
	}
	serve := func(items []string) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/repos/"+Repo+"/releases" || r.URL.Query().Get("per_page") == "" {
				http.NotFound(w, r)
				return
			}
			fmt.Fprint(w, "["+strings.Join(items, ",")+"]")
		}))
		t.Cleanup(srv.Close)
		API = srv.URL
	}
	serve(list)
	ctx := context.Background()
	if r, err := LatestWithNightlies(ctx, "linux", false); err != nil || r.Version != "1.5.0-nightly.20261025" || r.Asset != lin || r.Notes != "notes v1.5.0-nightly.20261025" {
		t.Errorf("linux: %+v %v", r, err)
	}
	if r, err := LatestWithNightlies(ctx, "windows", false); err != nil || r.Version != "1.5.0-nightly.20261026" {
		t.Errorf("windows: %+v %v", r, err)
	}
	// The release a nightly leads up to wins over it.
	serve(append([]string{rel("v1.5.0", false, false, lin, win)}, list...))
	if r, _ := LatestWithNightlies(ctx, "linux", false); r.Version != "1.5.0" {
		t.Errorf("release after nightlies: %q", r.Version)
	}
	serve([]string{rel("v2.0.0-beta.1", true, false, lin)})
	if _, err := LatestWithNightlies(ctx, "linux", false); err == nil {
		t.Error("a beta was offered")
	}
	for v, want := range map[string]bool{"1.5.0-nightly.20261026": true, "v1.5.0-nightly": true, "1.5.0": false, "1.5.0-beta.1": false, "1.5.0-nightlyish": false} {
		if IsNightly(v) != want {
			t.Errorf("IsNightly(%q) = %v", v, !want)
		}
	}
	if !Newer("1.5.0-nightly.20261026", "1.5.0-nightly.20261025") || !Newer("1.5.0", "1.5.0-nightly.20261026") || !Newer("1.5.0-nightly.1", "1.4.2") {
		t.Error("nightly ordering")
	}
}
