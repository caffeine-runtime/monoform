package imaging

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func samplePNG(t *testing.T, alpha bool) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, 32, 24))
	for y := 0; y < 24; y++ {
		for x := 0; x < 32; x++ {
			a := uint8(255)
			if alpha && x < 8 {
				a = 0
			}
			img.SetNRGBA(x, y, color.NRGBA{uint8(x * 8), uint8(y * 10), 120, a})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestTranscodeAllFormats(t *testing.T) {
	src := samplePNG(t, true)
	want := map[string]string{"png": "png", "jpg": "jpeg", "gif": "gif", "bmp": "bmp", "webp": "webp"}
	for f, decName := range want {
		out, err := TranscodeBytes(src, Options{Format: f})
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		img, name, err := image.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatalf("%s: decode back: %v", f, err)
		}
		if name != decName {
			t.Fatalf("%s: decoded as %s", f, name)
		}
		if img.Bounds().Dx() != 32 || img.Bounds().Dy() != 24 {
			t.Fatalf("%s: size %v", f, img.Bounds())
		}
	}
}

func TestJPEGFlattensOnWhite(t *testing.T) {
	out, err := TranscodeBytes(samplePNG(t, true), Options{Format: "jpeg", Quality: 95})
	if err != nil {
		t.Fatal(err)
	}
	img, _, _ := image.Decode(bytes.NewReader(out))
	r, g, b, _ := img.At(2, 2).RGBA()
	if r>>8 < 240 || g>>8 < 240 || b>>8 < 240 {
		t.Fatalf("transparent area not white: %d %d %d", r>>8, g>>8, b>>8)
	}
}

func TestWebPIsLossless(t *testing.T) {
	src := samplePNG(t, false)
	out, err := TranscodeBytes(src, Options{Format: "webp"})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := png.Decode(bytes.NewReader(src))
	b, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	for y := 0; y < 24; y++ {
		for x := 0; x < 32; x++ {
			r1, g1, b1, _ := a.At(x, y).RGBA()
			r2, g2, b2, _ := b.At(x, y).RGBA()
			if r1 != r2 || g1 != g2 || b1 != b2 {
				t.Fatalf("pixel %d,%d differs", x, y)
			}
		}
	}
}

func TestNormalizeAndErrors(t *testing.T) {
	if Normalize(".JPEG") != "jpg" || Normalize("TIF") != "tiff" || !Supported("Png") || !Supported("tif") || Supported("heic") {
		t.Fatal("normalize/supported")
	}
	if _, err := TranscodeBytes([]byte("nope"), Options{Format: "png"}); err == nil {
		t.Fatal("garbage decoded")
	}
	if _, err := TranscodeBytes(samplePNG(t, false), Options{Format: "heic"}); err == nil {
		t.Fatal("heic accepted")
	}
	b, err := TranscodeBytes(samplePNG(t, false), Options{Format: "tiff"})
	if err != nil || !bytes.HasPrefix(b, []byte("II*\x00")) && !bytes.HasPrefix(b, []byte("MM\x00*")) {
		t.Fatalf("tiff: %v", err)
	}
}
