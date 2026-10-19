package filetype

import (
	"os"
	"path/filepath"
	"testing"
)

func TestByName(t *testing.T) {
	cases := map[string]Kind{
		"notes.md":          Markdown,
		"README.MARKDOWN":   Markdown,
		"a/b/report.PDF":    PDF,
		"photo.JPEG":        Image,
		"anim.gif":          Image,
		"x.webp":            Image,
		"icon.svg":          SVG,
		"data.json":         JSON,
		"k8s.yml":           YAML,
		"table.tsv":         CSV,
		"backup.tar.gz":     Archive,
		"backup.TAR.GZ":     Archive,
		"bundle.7z":         Archive,
		"old.rar":           Archive,
		"SHA256SUMS":        Checksum,
		"file.iso.sha256":   Checksum,
		"main.go":           Text,
		"Makefile":          Text,
		"Dockerfile":        Text,
		"mystery":           Unknown,
		"weird.ext_unknown": Unknown,
	}
	for name, want := range cases {
		if got := ByName(name).Kind; got != want {
			t.Errorf("ByName(%q) = %q, want %q", name, got, want)
		}
	}
	if e := Ext("x.tar.gz"); e != "tar.gz" {
		t.Errorf("Ext tar.gz = %q", e)
	}
}

func TestSniff(t *testing.T) {
	tar := make([]byte, 512)
	copy(tar[257:], "ustar")
	cases := []struct {
		name string
		b    []byte
		want Kind
		mime string
	}{
		{"pdf", []byte("%PDF-1.7\n..."), PDF, "application/pdf"},
		{"png", []byte("\x89PNG\r\n\x1a\n\x00\x00"), Image, "image/png"},
		{"jpeg", []byte{0xFF, 0xD8, 0xFF, 0xE0}, Image, "image/jpeg"},
		{"gif", []byte("GIF89a...."), Image, "image/gif"},
		{"webp", []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), Image, "image/webp"},
		{"bmp", append([]byte("BM\x36\x00\x0c\x00\x00\x00\x00\x00\x36\x00\x00\x00"), 0), Image, "image/bmp"},
		{"zip", []byte("PK\x03\x04\x14\x00"), Archive, "application/zip"},
		{"rar", []byte("Rar!\x1a\x07\x01\x00"), Archive, "application/vnd.rar"},
		{"7z", []byte{'7', 'z', 0xBC, 0xAF, 0x27, 0x1C, 0, 4}, Archive, "application/x-7z-compressed"},
		{"gzip", []byte{0x1F, 0x8B, 0x08}, Archive, "application/gzip"},
		{"tar", tar, Binary, ""},
		{"json", []byte("  {\"a\": 1}"), JSON, "application/json"},
		{"svg", []byte("<?xml version=\"1.0\"?>\n<svg xmlns=..."), SVG, "image/svg+xml"},
		{"yaml", []byte("---\nkey: value\n"), YAML, "application/yaml"},
		{"text", []byte("hello world\nsecond line"), Text, "text/plain"},
		{"utf8", []byte("zażółć gęślą jaźń"), Text, "text/plain"},
		{"utf16", []byte{0xFF, 0xFE, 'h', 0, 'i', 0}, Text, "text/plain"},
		{"binary", []byte{0x00, 0x01, 0x02, 0x03, 0xFF}, Binary, "application/octet-stream"},
	}
	for _, c := range cases {
		got := Sniff(c.b)
		if c.name == "tar" {
			// A zero-filled tar header has NULs; magic must still win.
			if got.Kind != Archive || got.Mime != "application/x-tar" {
				t.Errorf("tar: got %+v", got)
			}
			continue
		}
		if got.Kind != c.want || (c.mime != "" && got.Mime != c.mime) {
			t.Errorf("%s: Sniff = %+v, want %s %s", c.name, got, c.want, c.mime)
		}
		if !got.ByMagic {
			t.Errorf("%s: ByMagic not set", c.name)
		}
	}
}

func TestDetectFallsBackToMagic(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "download")
	os.WriteFile(p, []byte("%PDF-1.4\n%..."), 0o644)
	info, err := Detect(p)
	if err != nil || info.Kind != PDF || !info.ByMagic {
		t.Fatalf("Detect = %+v, %v", info, err)
	}
	// Extension wins over content.
	q := filepath.Join(dir, "notes.txt")
	os.WriteFile(q, []byte("%PDF-1.4"), 0o644)
	info, _ = Detect(q)
	if info.Kind != Text || info.ByMagic {
		t.Fatalf("extension should win: %+v", info)
	}
}

func TestLooksLikeTextTruncatedRune(t *testing.T) {
	b := []byte("abc ż")
	if !LooksLikeText(b[:len(b)-1]) {
		t.Fatal("truncated trailing rune should still be text")
	}
}
