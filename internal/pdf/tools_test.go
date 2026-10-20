package pdf

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

func writePNG(t *testing.T, path string, w, h int, alpha bool) {
	t.Helper()
	m := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// A smooth photo-like gradient with some texture: Flate stores it big, JPEG small.
			v := 128 + 60*math.Sin(float64(x)/37) + 40*math.Cos(float64(y)/23)
			a := uint8(255)
			if alpha && (x+y)%7 == 0 {
				a = 0
			}
			m.Set(x, y, color.NRGBA{uint8(v), uint8(255 - v), uint8((x * y) % 256), a})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, m); err != nil {
		t.Fatal(err)
	}
}

func TestFromImagesAndCompress(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	a := filepath.Join(dir, "a.png")
	b := filepath.Join(dir, "b.png")
	writePNG(t, a, 1800, 1200, false)
	writePNG(t, b, 400, 600, false)
	out := filepath.Join(dir, "imgs.pdf")
	if err := FromImages(ctx, []string{a, b}, out, "image"); err != nil {
		t.Fatal(err)
	}
	if n, _ := PageCount(ctx, out); n != 2 {
		t.Fatalf("pages = %d", n)
	}
	dims, err := api.PageDimsFile(ctx, out)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(dims[0].Width/dims[0].Height-1.5) > 0.01 {
		t.Errorf("page 1 should have the image's shape, got %v", dims[0])
	}
	a4 := filepath.Join(dir, "a4.pdf")
	if err := FromImages(ctx, []string{a, b}, a4, "A4"); err != nil {
		t.Fatal(err)
	}
	if d, _ := api.PageDimsFile(ctx, a4); math.Abs(d[1].Width-595.28) > 1 || math.Abs(d[1].Height-841.89) > 1 {
		t.Errorf("A4 page = %v", d[1])
	}

	small := filepath.Join(dir, "small.pdf")
	r, err := Compress(ctx, out, small, 60, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if r.Images < 2 || r.Recompressed < 1 || r.After >= r.Before/2 {
		t.Errorf("compress: %+v", r)
	}
	if err := Validate(ctx, small); err != nil {
		t.Errorf("compressed PDF invalid: %v", err)
	}
	// Lossless clean-up keeps every image.
	clean := filepath.Join(dir, "clean.pdf")
	r2, err := Compress(ctx, out, clean, 0, 0)
	if err != nil || r2.Recompressed != 0 {
		t.Errorf("lossless: %+v %v", r2, err)
	}
	if err := Validate(ctx, clean); err != nil {
		t.Errorf("clean PDF invalid: %v", err)
	}
}

func TestStampAndReplace(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	src := write(t, dir, "m.pdf", 2)
	sig := filepath.Join(dir, "sig.png")
	writePNG(t, sig, 120, 40, true)

	stamped := filepath.Join(dir, "stamped.pdf")
	if err := StampImages(ctx, src, stamped, []Stamp{{Page: 2, Image: sig, M: [6]float64{120, 0, 0, 40, 300, 100}}}); err != nil {
		t.Fatal(err)
	}
	if err := Validate(ctx, stamped); err != nil {
		t.Fatalf("stamped invalid: %v", err)
	}
	if got := pageTexts(t, stamped); got[0] != "Page 1" || got[1] != "Page 2" {
		t.Errorf("text kept: %v", got)
	}
	content := contentOf(t, stamped, 2)
	if !contains(content, "q 120 0 0 40 300 100 cm /HiaImg1 Do Q") {
		t.Errorf("page 2 content: %q", content)
	}
	if contains(contentOf(t, stamped, 1), "HiaImg") {
		t.Error("page 1 should be untouched")
	}
	if err := StampImages(ctx, src, filepath.Join(dir, "x.pdf"), []Stamp{{Page: 3, Image: sig}}); err == nil {
		t.Error("page out of range accepted")
	}

	red := filepath.Join(dir, "red.pdf")
	if err := ReplaceWithImages(ctx, src, red, []PageImage{{Page: 1, Image: sig, M: [6]float64{612, 0, 0, 792, 0, 0}}}); err != nil {
		t.Fatal(err)
	}
	if err := Validate(ctx, red); err != nil {
		t.Fatalf("redacted invalid: %v", err)
	}
	got := pageTexts(t, red)
	if got[0] != "" || got[1] != "Page 2" {
		t.Errorf("page 1 text should be gone, page 2 kept: %v", got)
	}
}

func contentOf(t *testing.T, path string, page int) string {
	t.Helper()
	dir := t.TempDir()
	if err := api.ExtractContentFile(context.Background(), path, dir, []string{itoa(page)}, conf()); err != nil {
		t.Fatal(err)
	}
	files, _ := os.ReadDir(dir)
	s := ""
	for _, f := range files {
		b, _ := os.ReadFile(filepath.Join(dir, f.Name()))
		s += string(b)
	}
	return s
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for ; n > 0; n /= 10 {
		s = string(rune('0'+n%10)) + s
	}
	return s
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
