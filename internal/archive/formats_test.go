package archive

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func names(info Info) string {
	var out []string
	for _, e := range info.Entries {
		if !e.IsDir {
			out = append(out, e.Name)
		}
	}
	return strings.Join(out, ",")
}

func read(t *testing.T, p, entry string) string {
	t.Helper()
	var b bytes.Buffer
	if err := ReadEntry(context.Background(), p, entry, &b, 1<<20); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

func TestDeb(t *testing.T) {
	p := "testdata/hia-test.deb"
	info, err := List(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Format != "deb" || info.Meta["Package"] != "hia-test" || info.Meta["Version"] != "1.2.3" || info.Meta["Summary"] != "A test package" {
		t.Fatalf("deb info: %s %v", info.Format, info.Meta)
	}
	if got := names(info); !strings.Contains(got, "control/control") || !strings.Contains(got, "data/usr/share/hia/hello.txt") || !strings.Contains(got, "debian-binary") {
		t.Errorf("deb entries: %s", got)
	}
	if s := read(t, p, "data/usr/share/hia/hello.txt"); s != "hello from deb\n" {
		t.Errorf("deb file: %q", s)
	}
	if s := read(t, p, "control/control"); !strings.HasPrefix(s, "Package: hia-test") {
		t.Errorf("control: %q", s)
	}
}

func TestRPM(t *testing.T) {
	p := "testdata/hia-test.rpm"
	info, err := List(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Format != "rpm" || info.Meta["Package"] != "hia-test" || info.Meta["Version"] != "2.0.1" || info.Meta["Architecture"] != "noarch" || info.Meta["License"] != "CC0" {
		t.Fatalf("rpm info: %v", info.Meta)
	}
	var link string
	for _, e := range info.Entries {
		if e.Name == "usr/share/hia/link.txt" {
			link = e.Link
		}
	}
	if link != "hello.txt" {
		t.Errorf("symlink target %q (entries %s)", link, names(info))
	}
	if s := read(t, p, "usr/share/hia/hello.txt"); s != "hello from rpm\n" {
		t.Errorf("rpm file: %q", s)
	}
}

func TestISO(t *testing.T) {
	p := "testdata/hia-test.iso"
	info, err := List(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Format != "iso" || info.Meta["Volume"] != "HIA_TEST" {
		t.Fatalf("iso info: %s %v", info.Format, info.Meta)
	}
	long := "docs/a long folder name/Read Me (long name).txt"
	if !strings.Contains(names(info), long) || !strings.Contains(names(info), "TOP.TXT") {
		t.Fatalf("long names lost: %s", names(info))
	}
	if s := read(t, p, long); s != "hello from iso\n" {
		t.Errorf("iso file: %q", s)
	}
	dst := t.TempDir()
	if _, err := Extract(context.Background(), p, dst, Options{}, nil); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(filepath.Join(dst, filepath.FromSlash(long))); err != nil || string(b) != "hello from iso\n" {
		t.Errorf("extracted: %q %v", b, err)
	}
}

func TestMSI(t *testing.T) {
	p := "testdata/hia-test.msi" // made with msitools' wixl (MSZIP cabinet embedded)
	info, err := List(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Format != "msi" || info.Meta["Package"] != "Hia Test" || info.Meta["Version"] != "1.2.3" || info.Meta["Manufacturer"] != "Hold It All" {
		t.Fatalf("msi info: %s %v", info.Format, info.Meta)
	}
	if got := names(info); got != "Program Files/HiaTest/docs/LongReadmeFile.txt,Program Files/HiaTest/hello.txt" {
		t.Errorf("msi entries: %s", got)
	}
	if s := read(t, p, "Program Files/HiaTest/hello.txt"); s != "hello from msi\n" {
		t.Errorf("msi file: %q", s)
	}
	if s := read(t, p, "Program Files/HiaTest/docs/LongReadmeFile.txt"); s != longReadme() { // spans several MSZIP blocks
		t.Errorf("msi long file: %d bytes", len(s))
	}
	// A .doc shares the compound-file magic; without the .msi extension it's not ours.
	dir := t.TempDir()
	data, _ := os.ReadFile(p)
	os.WriteFile(filepath.Join(dir, "x.doc"), data, 0o644)
	if _, err := List(context.Background(), filepath.Join(dir, "x.doc")); err == nil {
		t.Error(".doc listed as an archive")
	}
}

func longReadme() string {
	var b strings.Builder
	for i := 0; i < 5000; i++ {
		fmt.Fprintf(&b, "line %d of the readme\n", i%997)
	}
	return b.String()
}
