package newfile

import (
	"errors"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"github.com/caffeine-runtime/monoform/internal/office"
)

func TestCreateEveryKind(t *testing.T) {
	dir := t.TempDir()
	for kind, ext := range Kinds {
		p := filepath.Join(dir, "New "+kind+ext)
		if err := Create(p, kind, Options{Width: 64, Height: 32, Background: "white"}); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if err := Create(p, kind, Options{}); !errors.Is(err, os.ErrExist) {
			t.Fatalf("%s: second create: %v", kind, err)
		}
	}
	md, _ := os.ReadFile(filepath.Join(dir, "New markdown.md"))
	if string(md) != "# New markdown\n\n" {
		t.Fatalf("markdown: %q", md)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "New html.html")); !strings.Contains(string(b), "<title>New html</title>") {
		t.Fatalf("html: %s", b)
	}
	if _, err := office.ReadDocx(filepath.Join(dir, "New docx.docx")); err != nil {
		t.Fatalf("docx unreadable: %v", err)
	}
	x, err := excelize.OpenFile(filepath.Join(dir, "New xlsx.xlsx"))
	if err != nil || len(x.GetSheetList()) != 1 {
		t.Fatalf("xlsx: %v", err)
	}
	f, _ := os.Open(filepath.Join(dir, "New image.png"))
	img, err := png.Decode(f)
	f.Close()
	if err != nil || img.Bounds().Dx() != 64 || img.Bounds().Dy() != 32 {
		t.Fatalf("png: %v %v", err, img.Bounds())
	}
	if r, g, b, a := img.At(3, 3).RGBA(); r != 0xffff || g != 0xffff || b != 0xffff || a != 0xffff {
		t.Fatal("background not white")
	}
}

func TestRejects(t *testing.T) {
	dir := t.TempDir()
	if err := Create(filepath.Join(dir, "x.bin"), "binary", Options{}); err == nil {
		t.Fatal("unknown kind accepted")
	}
	if err := Create(filepath.Join(dir, "big.png"), "image", Options{Width: MaxImageSide + 1, Height: 10}); err == nil {
		t.Fatal("oversized image accepted")
	}
	if err := Create(filepath.Join(dir, "c.png"), "image", Options{Background: "pink"}); err == nil {
		t.Fatal("bad background accepted")
	}
}
