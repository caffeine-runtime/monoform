// Package imaging encodes edited images. The frontend flattens its canvas to
// PNG (which every webview can produce) and Go re-encodes to the target
// format, so saving behaves the same on WebView2, WKWebView and WebKitGTK
// (which can't all encode WebP/GIF/BMP from a canvas).
package imaging

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"strings"

	"github.com/HugoSmits86/nativewebp"
	"golang.org/x/image/bmp"
	"golang.org/x/image/tiff"
	_ "golang.org/x/image/webp" // decoding WebP input
)

// Formats that can be written.
var Formats = []string{"png", "jpg", "webp", "gif", "bmp", "tiff"}

// Normalize maps extensions/aliases to a format name ("jpeg" -> "jpg").
func Normalize(f string) string {
	f = strings.ToLower(strings.TrimPrefix(f, "."))
	switch f {
	case "jpeg", "jfif", "jpe":
		return "jpg"
	case "tif":
		return "tiff"
	}
	return f
}

func Supported(f string) bool {
	f = Normalize(f)
	for _, x := range Formats {
		if x == f {
			return true
		}
	}
	return false
}

type Options struct {
	Format  string
	Quality int // JPEG quality 1-100 (default 92)
	// Background for formats without alpha (JPEG, BMP). Default white.
	Background color.Color
}

// Transcode decodes src (any supported input format) and writes it as opts.Format.
func Transcode(w io.Writer, src io.Reader, opts Options) error {
	img, _, err := image.Decode(src)
	if err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return Encode(w, img, opts)
}

// Encode writes img in the requested format.
func Encode(w io.Writer, img image.Image, opts Options) error {
	f := Normalize(opts.Format)
	switch f {
	case "png":
		enc := png.Encoder{CompressionLevel: png.DefaultCompression}
		return enc.Encode(w, img)
	case "jpg":
		q := opts.Quality
		if q <= 0 || q > 100 {
			q = 92
		}
		return jpeg.Encode(w, flatten(img, opts.Background), &jpeg.Options{Quality: q})
	case "bmp":
		return bmp.Encode(w, flatten(img, opts.Background))
	case "tiff":
		return tiff.Encode(w, img, &tiff.Options{Compression: tiff.Deflate, Predictor: true})
	case "gif":
		// Single frame, 256-colour palette with dithering.
		return gif.Encode(w, img, &gif.Options{NumColors: 256})
	case "webp":
		// Pure-Go encoder: lossless VP8L.
		return nativewebp.Encode(w, img, nil)
	default:
		return errors.New("unsupported format: " + opts.Format)
	}
}

// flatten composites img over a solid background (formats without alpha).
func flatten(img image.Image, bg color.Color) image.Image {
	if bg == nil {
		bg = color.White
	}
	if opaque(img) {
		return img
	}
	b := img.Bounds()
	out := image.NewRGBA(b)
	draw.Draw(out, b, image.NewUniform(bg), image.Point{}, draw.Src)
	draw.Draw(out, b, img, b.Min, draw.Over)
	return out
}

func opaque(img image.Image) bool {
	if o, ok := img.(interface{ Opaque() bool }); ok {
		return o.Opaque()
	}
	return false
}

// TranscodeBytes is a convenience wrapper.
func TranscodeBytes(src []byte, opts Options) ([]byte, error) {
	var buf bytes.Buffer
	if err := Transcode(&buf, bytes.NewReader(src), opts); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
