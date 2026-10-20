package imaging

import (
	"context"
	"errors"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestConvertHEICWithSystem(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "out.png")
	tool, err := ConvertWithSystem(context.Background(), "testdata/sample.heic", dst)
	var none ErrNoSystemDecoder
	if errors.As(err, &none) {
		// Tools may be installed without an HEVC plugin; CI installs one.
		t.Skip("no working HEIC decoder here: " + none.Hint)
	}
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 64 || b.Dy() != 48 {
		t.Fatalf("%s: size %v", tool, b)
	}
	// Left half red, right half blue.
	r, _, bl, _ := img.At(8, 24).RGBA()
	r2, _, b2, _ := img.At(56, 24).RGBA()
	if r>>8 < 150 || bl>>8 > 100 || r2>>8 > 100 || b2>>8 < 150 {
		t.Errorf("%s: colours %d/%d %d/%d", tool, r>>8, bl>>8, r2>>8, b2>>8)
	}
	t.Logf("converted with %s", tool)
}
