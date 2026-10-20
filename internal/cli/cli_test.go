package cli

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func run(t *testing.T, args ...string) (string, string, int) {
	t.Helper()
	var out, errb bytes.Buffer
	code, ok := Main(args, "1.2.3", &out, &errb)
	if !ok {
		t.Fatalf("%v: not handled as a command", args)
	}
	return out.String(), errb.String(), code
}

func write(t *testing.T, dir, name, body string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestOpenFilesIsNotACommand(t *testing.T) {
	dir := t.TempDir()
	for _, args := range [][]string{nil, {"notes.txt"}, {"--peek", "a.pdf"}, {write(t, dir, "hash", "x")}} {
		if _, ok := Main(args, "", &bytes.Buffer{}, &bytes.Buffer{}); ok {
			t.Errorf("%v handled as a command", args)
		}
	}
	if out, _, code := run(t, "--version"); code != 0 || out != "Hold It All 1.2.3\n" {
		t.Errorf("version: %q", out)
	}
	if out, _, _ := run(t, "help"); !strings.Contains(out, "holdit hash") {
		t.Error("help text")
	}
}

func TestHash(t *testing.T) {
	dir := t.TempDir()
	a := write(t, dir, "a.iso", "hello\n")
	write(t, dir, "b.iso", "")
	out, _, code := run(t, "hash", a)
	if code != 0 || out != "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  "+a+"\n" {
		t.Errorf("sha256: %q", out)
	}
	// A pattern the shell didn't expand (Windows).
	out, _, code = run(t, "hash", "-a", "md5,sha1", filepath.Join(dir, "*.iso"))
	if code != 0 || strings.Count(out, "\n") != 4 || !strings.Contains(out, "MD5 ("+a+") = b1946ac92492d2347c6235b4d2611184") || !strings.Contains(out, "SHA1 (") {
		t.Errorf("globbed: %q", out)
	}
	_, errs, code := run(t, "hash", filepath.Join(dir, "nope"), a)
	if code != 2 || !strings.Contains(errs, "no such file") {
		t.Errorf("missing: %d %q", code, errs)
	}
	if _, errs, code := run(t, "hash", "-a", "crc32", a); code != 2 || !strings.Contains(errs, "unknown algorithm") {
		t.Errorf("bad algo: %d %q", code, errs)
	}
	if _, _, code := run(t, "hash", dir); code != 2 {
		t.Error("folder hashed")
	}
	if out, _, _ := run(t, "hash", "-a", "all", a); strings.Count(out, "\n") != 5 {
		t.Errorf("all: %q", out)
	}
}

func TestVerify(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "a.iso", "hello\n")
	write(t, dir, "b.iso", "changed")
	sums := write(t, dir, "SHA256SUMS", "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  a.iso\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  b.iso\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  gone.iso\n")
	out, errs, code := run(t, "verify", sums)
	if code != 1 || !strings.Contains(out, "a.iso: OK") || !strings.Contains(out, "b.iso: FAILED") || !strings.Contains(out, "gone.iso: MISSING") || !strings.Contains(errs, "1 OK, 1 failed, 1 missing") {
		t.Errorf("%d %q %q", code, out, errs)
	}
	// A list elsewhere, names relative to the current folder (as sha256sum -c reads them).
	other := write(t, t.TempDir(), "list.sha256", "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  a.iso\n")
	wd, _ := os.Getwd()
	os.Chdir(dir)
	out, _, code = run(t, "verify", other)
	os.Chdir(wd)
	if code != 0 || out != "a.iso: OK\n" {
		t.Errorf("relative to the current folder: %d %q", code, out)
	}
	ok := write(t, dir, "ok.sha256", "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  a.iso\n")
	if _, _, code := run(t, "verify", ok); code != 0 {
		t.Errorf("all good: %d", code)
	}
}

func TestInfoAndConvert(t *testing.T) {
	dir := t.TempDir()
	m := image.NewNRGBA(image.Rect(0, 0, 40, 30))
	for i := range m.Pix {
		m.Pix[i] = 200
	}
	m.Set(1, 1, color.NRGBA{255, 0, 0, 255})
	src := filepath.Join(dir, "pic.png")
	f, _ := os.Create(src)
	png.Encode(f, m)
	f.Close()
	out, _, code := run(t, "info", src)
	if code != 0 || !strings.Contains(out, "type: image (image/png)") || !strings.Contains(out, "image: 40 × 30 png") {
		t.Errorf("info: %q", out)
	}
	for _, ext := range []string{"jpg", "webp", "ico", "bmp"} {
		dst := filepath.Join(dir, "out."+ext)
		out, errs, code := run(t, "convert", src, dst)
		if code != 0 || !strings.Contains(out, "(40 × 30)") {
			t.Fatalf("convert %s: %d %q %q", ext, code, out, errs)
		}
		if st, err := os.Stat(dst); err != nil || st.Size() == 0 {
			t.Errorf("%s not written", ext)
		}
	}
	// And back from the icon.
	if out, errs, code := run(t, "convert", filepath.Join(dir, "out.ico"), filepath.Join(dir, "back.png")); code != 0 {
		t.Errorf("from ico: %q %q", out, errs)
	}
	if _, _, code := run(t, "convert", src); code != 2 {
		t.Error("missing argument accepted")
	}
	if _, errs, code := run(t, "convert", write(t, dir, "x.txt", "not an image"), filepath.Join(dir, "x.png")); code != 2 || errs == "" {
		t.Errorf("text converted: %q", errs)
	}
}
