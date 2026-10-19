// Package newfile creates starter files of each kind the app can edit:
// plain text formats from small templates, Word and Excel files as valid
// empty packages, and blank PNG images. It never overwrites a file.
package newfile

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/xuri/excelize/v2"

	"github.com/caffeine-runtime/hold-it-all/internal/fs"
	"github.com/caffeine-runtime/hold-it-all/internal/office"
)

// Kinds lists the kinds Create understands with their default extension.
var Kinds = map[string]string{
	"text":     ".txt",
	"markdown": ".md",
	"docx":     ".docx",
	"xlsx":     ".xlsx",
	"csv":      ".csv",
	"json":     ".json",
	"html":     ".html",
	"svg":      ".svg",
	"image":    ".png",
}

// Options are kind-specific settings.
type Options struct {
	Width      int    `json:"width"`      // image/svg
	Height     int    `json:"height"`     // image/svg
	Background string `json:"background"` // image: "transparent", "white" or "black"
}

// MaxImageSide bounds blank images (64 MP at most).
const MaxImageSide = 8192

// Create writes a new file of the given kind at p. It fails if p exists.
func Create(p, kind string, o Options) error {
	if _, ok := Kinds[kind]; !ok {
		return fmt.Errorf("unknown file kind %q", kind)
	}
	if _, err := os.Lstat(p); err == nil {
		return os.ErrExist
	}
	title := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
	switch kind {
	case "docx":
		return office.WriteDocx(p, "", office.ParagraphsToDocument([]string{""}))
	case "xlsx":
		f := excelize.NewFile()
		defer f.Close()
		return fs.AtomicWrite(p, func(w io.Writer) error { return f.Write(w) })
	case "image":
		return createImage(p, o)
	}
	return writeNew(p, []byte(textTemplate(kind, title, o)))
}

func textTemplate(kind, title string, o Options) string {
	switch kind {
	case "markdown":
		return "# " + title + "\n\n"
	case "csv":
		return "Column A,Column B,Column C\n"
	case "json":
		return "{\n  \n}\n"
	case "html":
		return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>` + htmlEscape(title) + `</title>
</head>
<body>
  <h1>` + htmlEscape(title) + `</h1>
</body>
</html>
`
	case "svg":
		w, h := dims(o, 800, 600)
		return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">
  <rect width="100%%" height="100%%" fill="#ffffff"/>
</svg>
`, w, h, w, h)
	}
	return ""
}

func dims(o Options, w, h int) (int, int) {
	if o.Width > 0 {
		w = o.Width
	}
	if o.Height > 0 {
		h = o.Height
	}
	return w, h
}

func createImage(p string, o Options) error {
	w, h := dims(o, 1920, 1080)
	if w < 1 || h < 1 || w > MaxImageSide || h > MaxImageSide {
		return fmt.Errorf("image size must be between 1 and %d pixels per side", MaxImageSide)
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	switch o.Background {
	case "", "transparent":
	case "white":
		draw.Draw(img, img.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	case "black":
		draw.Draw(img, img.Bounds(), image.NewUniform(color.Black), image.Point{}, draw.Src)
	default:
		return errors.New("background must be transparent, white or black")
	}
	return fs.AtomicWrite(p, func(wr io.Writer) error {
		return (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(wr, img)
	})
}

// writeNew creates p exclusively so a file appearing meanwhile isn't clobbered.
func writeNew(p string, data []byte) error {
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(p)
		return err
	}
	return f.Close()
}

func htmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}
