package archive

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

var ctx = context.Background()

type zent struct {
	name    string
	body    string
	symlink bool
	method  uint16
}

func makeZip(t *testing.T, path string, entries []zent) {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		h := &zip.FileHeader{Name: e.name, Method: e.method, Modified: time.Now()}
		if e.symlink {
			h.SetMode(os.ModeSymlink | 0o777)
		} else {
			h.SetMode(0o644)
		}
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(e.body))
	}
	zw.Close()
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

type tent struct {
	name, body, link string
	typ              byte
}

func makeTarGz(t *testing.T, path string, entries []tent) {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, e := range entries {
		typ := e.typ
		if typ == 0 {
			typ = tar.TypeReg
		}
		h := &tar.Header{Name: e.name, Typeflag: typ, Mode: 0o644, Size: int64(len(e.body)), Linkname: e.link, ModTime: time.Now()}
		if typ != tar.TypeReg {
			h.Size = 0
		}
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if typ == tar.TypeReg {
			tw.Write([]byte(e.body))
		}
	}
	tw.Close()
	gz.Close()
	os.WriteFile(path, buf.Bytes(), 0o644)
}

func skippedNames(r Result) string {
	var s []string
	for _, k := range r.Skipped {
		s = append(s, k.Name+"="+k.Reason)
	}
	return strings.Join(s, "; ")
}

func noFileOutside(t *testing.T, base string) {
	t.Helper()
	des, _ := os.ReadDir(base)
	for _, d := range des {
		if d.Name() != "dest" && d.Name() != "a.zip" && d.Name() != "a.tar.gz" {
			t.Fatalf("file escaped destination: %s", d.Name())
		}
	}
}

func TestZipSlip(t *testing.T) {
	base := t.TempDir()
	arch := filepath.Join(base, "a.zip")
	makeZip(t, arch, []zent{
		{name: "../evil.txt", body: "x"},
		{name: "/abs.txt", body: "x"},
		{name: "ok/../../evil2.txt", body: "x"},
		{name: "C:\\win.txt", body: "x"},
		{name: "..\\back.txt", body: "x"},
		{name: "ok/good.txt", body: "good"},
		{name: "ok/link-out", body: "../../../etc/passwd", symlink: true},
		{name: "ok/link-abs", body: "/etc/passwd", symlink: true},
		{name: "ok/link-in", body: "good.txt", symlink: true},
	})
	dest := filepath.Join(base, "dest")
	res, err := Extract(ctx, arch, dest, Options{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	noFileOutside(t, base)
	if b, err := os.ReadFile(filepath.Join(dest, "ok", "good.txt")); err != nil || string(b) != "good" {
		t.Fatalf("good file: %q %v", b, err)
	}
	sk := skippedNames(res)
	for _, bad := range []string{"../evil.txt", "/abs.txt", "ok/../../evil2.txt", "C:/win.txt", "../back.txt", "ok/link-out", "ok/link-abs"} {
		if !strings.Contains(sk, bad+"=") {
			t.Errorf("%s not refused; skipped: %s", bad, sk)
		}
	}
	if runtime.GOOS != "windows" {
		target, err := os.Readlink(filepath.Join(dest, "ok", "link-in"))
		if err != nil || target != "good.txt" {
			t.Fatalf("inside link: %q %v", target, err)
		}
		if res.Links != 1 {
			t.Fatalf("links = %d", res.Links)
		}
	}
	if res.Files != 1 {
		t.Fatalf("files = %d (%s)", res.Files, sk)
	}
}

func TestTarSymlinkThenWrite(t *testing.T) {
	// Classic attack: a symlink pointing outside, then a file "through" it.
	base := t.TempDir()
	outside := filepath.Join(base, "outside")
	os.Mkdir(outside, 0o755)
	arch := filepath.Join(base, "a.tar.gz")
	makeTarGz(t, arch, []tent{
		{name: "escape", typ: tar.TypeSymlink, link: "../outside"},
		{name: "escape/pwned.txt", body: "pwned"},
		{name: "dot", typ: tar.TypeSymlink, link: "."},
		{name: "hard", typ: tar.TypeLink, link: "../../etc/passwd"},
		{name: "fine/file.txt", body: "fine"},
	})
	dest := filepath.Join(base, "dest")
	res, err := Extract(ctx, arch, dest, Options{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(outside, "pwned.txt")); err == nil {
		t.Fatal("wrote through an escaping symlink")
	}
	sk := skippedNames(res)
	for _, bad := range []string{"escape=", "dot=", "hard="} {
		if !strings.Contains(sk, bad) {
			t.Errorf("%s not refused: %s", bad, sk)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "fine", "file.txt")); string(b) != "fine" {
		t.Fatal("regular file missing")
	}
}

func TestPreexistingSymlinkInDest(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip()
	}
	// A symlink already in the destination must not redirect writes.
	base := t.TempDir()
	outside := filepath.Join(base, "outside")
	os.Mkdir(outside, 0o755)
	dest := filepath.Join(base, "dest")
	os.Mkdir(dest, 0o755)
	os.Symlink(outside, filepath.Join(dest, "sub"))
	arch := filepath.Join(base, "a.zip")
	makeZip(t, arch, []zent{{name: "sub/x.txt", body: "x"}})
	res, _ := Extract(ctx, arch, dest, Options{}, nil)
	if _, err := os.Stat(filepath.Join(outside, "x.txt")); err == nil {
		t.Fatal("followed a pre-existing symlink out of the destination")
	}
	if res.Files != 0 || len(res.Skipped) == 0 {
		t.Fatalf("res = %+v", res)
	}
}

func TestBombLimits(t *testing.T) {
	base := t.TempDir()
	arch := filepath.Join(base, "bomb.zip")
	makeZip(t, arch, []zent{{name: "zeros.bin", body: strings.Repeat("\x00", 20<<20), method: zip.Deflate}})
	st, _ := os.Stat(arch)
	if st.Size() > 200<<10 {
		t.Fatalf("test archive too big: %d", st.Size())
	}
	dest := filepath.Join(base, "d1")
	_, err := Extract(ctx, arch, dest, Options{Limits: Limits{MaxBytes: 1 << 20}}, nil)
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("size limit: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "zeros.bin")); err == nil {
		t.Fatal("partial file left behind")
	}
	_, err = Extract(ctx, arch, filepath.Join(base, "d2"), Options{Limits: Limits{MaxRatio: 50, RatioFloor: 1 << 20}}, nil)
	if !errors.Is(err, ErrRatio) {
		t.Fatalf("ratio limit: %v", err)
	}
	var many []zent
	for i := 0; i < 300; i++ {
		many = append(many, zent{name: "f/" + strings.Repeat("a", i%5+1) + string(rune('a'+i%26)) + ".txt"})
	}
	for i := range many {
		many[i].name = filepath.ToSlash(filepath.Join("f", time.Now().Format("150405")+string(rune('A'+i%26))+strings.Repeat("x", i)))
	}
	arch2 := filepath.Join(base, "many.zip")
	makeZip(t, arch2, many)
	_, err = Extract(ctx, arch2, filepath.Join(base, "d3"), Options{Limits: Limits{MaxEntries: 100}}, nil)
	if !errors.Is(err, ErrTooManyEntries) {
		t.Fatalf("entry limit: %v", err)
	}
	// Defaults let a legitimate archive through.
	if _, err := Extract(ctx, arch, filepath.Join(base, "d4"), Options{}, nil); err != nil {
		t.Fatalf("default limits: %v", err)
	}
}

func TestListReadSelect(t *testing.T) {
	base := t.TempDir()
	arch := filepath.Join(base, "a.tar.gz")
	makeTarGz(t, arch, []tent{
		{name: "proj/src/main.go", body: "package main"},
		{name: "proj/README.md", body: "# hi"},
		{name: "other.txt", body: "o"},
	})
	info, err := List(ctx, arch)
	if err != nil {
		t.Fatal(err)
	}
	if info.Format != "tar.gz" || info.Writable {
		t.Fatalf("info = %+v", info)
	}
	var names []string
	for _, e := range info.Entries {
		names = append(names, e.Name)
	}
	if strings.Join(names, ",") != "other.txt,proj,proj/README.md,proj/src,proj/src/main.go" {
		t.Fatalf("names = %v", names)
	}
	var buf bytes.Buffer
	if err := ReadEntry(ctx, arch, "proj/src/main.go", &buf, 1<<20); err != nil || buf.String() != "package main" {
		t.Fatalf("read = %q %v", buf.String(), err)
	}
	if err := ReadEntry(ctx, arch, "nope", &buf, 1<<20); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing entry: %v", err)
	}
	// Extract a folder: output relative to its parent.
	dest := filepath.Join(base, "out")
	res, err := Extract(ctx, arch, dest, Options{Entries: []string{"proj/src"}}, nil)
	if err != nil || res.Files != 1 {
		t.Fatalf("select: %+v %v", res, err)
	}
	if _, err := os.Stat(filepath.Join(dest, "src", "main.go")); err != nil {
		t.Fatal("selected folder not extracted relative to parent")
	}
	// Existing-file policies.
	res, _ = Extract(ctx, arch, dest, Options{Entries: []string{"proj/src"}, Existing: Skip}, nil)
	if len(res.Skipped) != 1 {
		t.Fatalf("skip policy: %+v", res)
	}
	Extract(ctx, arch, dest, Options{Entries: []string{"proj/src"}, Existing: Rename}, nil)
	if _, err := os.Stat(filepath.Join(dest, "src", "main (2).go")); err != nil {
		t.Fatal("rename policy")
	}
}

func TestSevenZip(t *testing.T) {
	info, err := List(ctx, "testdata/sample.7z")
	if err != nil {
		t.Fatal(err)
	}
	if info.Format != "7z" || info.Writable {
		t.Fatalf("info = %+v", info)
	}
	var buf bytes.Buffer
	if err := ReadEntry(ctx, "testdata/sample.7z", "docs/readme.txt", &buf, 1<<20); err != nil || buf.String() != "hello from 7z\n" {
		t.Fatalf("read = %q %v", buf.String(), err)
	}
	dest := t.TempDir()
	res, err := Extract(ctx, "testdata/sample.7z", dest, Options{}, nil)
	if err != nil || res.Files != 2 {
		t.Fatalf("extract: %+v %v", res, err)
	}
}

// rar5 builds a RAR 5 archive with stored (uncompressed) files, following
// the public RAR 5.0 format description.
func rar5(files map[string]string, order []string) []byte {
	vint := func(v uint64) []byte {
		var out []byte
		for {
			b := byte(v & 0x7f)
			v >>= 7
			if v != 0 {
				out = append(out, b|0x80)
			} else {
				return append(out, b)
			}
		}
	}
	block := func(fields []byte, data []byte) []byte {
		size := vint(uint64(len(fields)))
		hdr := append(append([]byte{}, size...), fields...)
		crc := make([]byte, 4)
		binary.LittleEndian.PutUint32(crc, crc32.ChecksumIEEE(hdr))
		return append(append(crc, hdr...), data...)
	}
	out := []byte{0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00}
	// main header: type 1, flags 0, archive flags 0
	out = append(out, block(append(append(vint(1), vint(0)...), vint(0)...), nil)...)
	for _, name := range order {
		body := []byte(files[name])
		var f []byte
		f = append(f, vint(2)...)                 // type: file
		f = append(f, vint(0x0002)...)            // header flags: data size present
		f = append(f, vint(uint64(len(body)))...) // data size
		f = append(f, vint(0x0004)...)            // file flags: CRC32 present
		f = append(f, vint(uint64(len(body)))...) // unpacked size
		f = append(f, vint(0x20)...)              // attributes
		crc := make([]byte, 4)
		binary.LittleEndian.PutUint32(crc, crc32.ChecksumIEEE(body))
		f = append(f, crc...)
		f = append(f, vint(0)...) // compression: version 0, store
		f = append(f, vint(1)...) // host OS: Unix
		f = append(f, vint(uint64(len(name)))...)
		f = append(f, []byte(name)...)
		out = append(out, block(f, body)...)
	}
	out = append(out, block(append(append(vint(5), vint(0)...), vint(0)...), nil)...)
	return out
}

func TestRar(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sample.rar")
	os.WriteFile(p, rar5(map[string]string{"notes/a.txt": "rar body", "b.txt": "second"}, []string{"notes/a.txt", "b.txt"}), 0o644)
	info, err := List(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Format != "rar" || info.Writable {
		t.Fatalf("info = %+v", info)
	}
	var buf bytes.Buffer
	if err := ReadEntry(ctx, p, "notes/a.txt", &buf, 1<<20); err != nil || buf.String() != "rar body" {
		t.Fatalf("read = %q %v", buf.String(), err)
	}
	dest := t.TempDir()
	res, err := Extract(ctx, p, dest, Options{}, nil)
	if err != nil || res.Files != 2 {
		t.Fatalf("extract: %+v %v", res, err)
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "b.txt")); string(b) != "second" {
		t.Fatal("rar content")
	}
}

func TestSingleGzip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "log.txt.gz")
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte("compressed log"))
	gz.Close()
	os.WriteFile(p, buf.Bytes(), 0o644)
	info, err := List(ctx, p)
	if err != nil || len(info.Entries) != 1 || info.Entries[0].Name != "log.txt" {
		t.Fatalf("info = %+v %v", info, err)
	}
	var out bytes.Buffer
	if err := ReadEntry(ctx, p, "log.txt", &out, 1<<20); err != nil || out.String() != "compressed log" {
		t.Fatalf("read = %q %v", out.String(), err)
	}
}

func TestCreateZip(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "folder")
	os.MkdirAll(filepath.Join(src, "sub"), 0o755)
	os.WriteFile(filepath.Join(src, "a.txt"), []byte("aaa"), 0o644)
	os.WriteFile(filepath.Join(src, "sub", "b.txt"), []byte("bbb"), 0o644)
	single := filepath.Join(dir, "single.md")
	os.WriteFile(single, []byte("# s"), 0o644)
	dest := filepath.Join(dir, "out.zip")
	res, err := CreateZip(ctx, []string{src, single}, dest, nil)
	if err != nil || res.Files != 3 {
		t.Fatalf("create: %+v %v", res, err)
	}
	zr, err := zip.OpenReader(dest)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	zr.Close()
	if strings.Join(names, ",") != "folder/,folder/a.txt,folder/sub/,folder/sub/b.txt,single.md" {
		t.Fatalf("names = %v", names)
	}
	if unzip, err := exec.LookPath("unzip"); err == nil {
		if out, err := exec.Command(unzip, "-t", dest).CombinedOutput(); err != nil {
			t.Fatalf("unzip -t: %v\n%s", err, out)
		}
	}
	// Round trip through our own reader.
	info, err := List(ctx, dest)
	if err != nil || !info.Writable || info.Format != "zip" {
		t.Fatalf("list created zip: %+v %v", info, err)
	}
}
