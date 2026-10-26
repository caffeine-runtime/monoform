package convert

import (
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"

	"github.com/caffeine-runtime/monoform/internal/fs"
	"github.com/caffeine-runtime/monoform/internal/imaging"
	"github.com/caffeine-runtime/monoform/internal/pdf"
)

func convertImage(ctx context.Context, src, dst, to string) error {
	if to == "pdf" {
		return imageToPDF(ctx, src, dst)
	}
	img, err := DecodeImage(ctx, src)
	if err != nil {
		return err
	}
	return fs.AtomicWrite(dst, func(w io.Writer) error {
		switch to {
		case "ico":
			return imaging.EncodeICO(w, img, nil)
		case "icns":
			return imaging.EncodeICNS(w, img)
		}
		return imaging.Encode(w, img, imaging.Options{Format: to, Quality: 92})
	})
}

// imageToPDF makes a one-page PDF the size of the picture. JPEG, PNG, TIFF
// and WebP go in as they are (a JPEG isn't recompressed); anything else is
// turned into a PNG first.
func imageToPDF(ctx context.Context, src, dst string) error {
	in := src
	switch Ext(src) {
	case "jpg", "png", "tiff", "webp":
	default:
		img, err := DecodeImage(ctx, src)
		if err != nil {
			return err
		}
		tmp, err := os.MkdirTemp("", "monoform-convert-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmp)
		in = filepath.Join(tmp, "page.png")
		if err := fs.AtomicWrite(in, func(w io.Writer) error { return imaging.Encode(w, img, imaging.Options{Format: "png"}) }); err != nil {
			return err
		}
	}
	// pdfcpu writes to the path it is given: build next to dst, then rename.
	tmp := filepath.Join(filepath.Dir(dst), "."+filepath.Base(dst)+".tmp.pdf")
	defer os.Remove(tmp)
	if err := pdf.FromImages(ctx, []string{in}, tmp, "image"); err != nil {
		return err
	}
	return fs.ReplaceFile(tmp, dst)
}

// DecodeImage reads a picture Go can decode, the largest image of an icon,
// or anything the system's tools can turn into a PNG (HEIC/HEIF, AVIF).
func DecodeImage(ctx context.Context, p string) (image.Image, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(f)
	f.Close()
	if err == nil {
		return img, nil
	}
	ext := strings.ToLower(filepath.Ext(p))
	if ext == ".ico" || ext == ".icns" {
		b, err := os.ReadFile(p)
		if err != nil {
			return nil, err
		}
		var imgs []imaging.IconImage
		if ext == ".ico" {
			imgs, err = imaging.DecodeICO(b)
		} else {
			imgs, err = imaging.DecodeICNS(b)
		}
		if err != nil || len(imgs) == 0 {
			return nil, fmt.Errorf("can't read this icon: %v", err)
		}
		var best *image.NRGBA
		for _, im := range imgs {
			if im.Img != nil && (best == nil || im.Img.Bounds().Dx() > best.Bounds().Dx()) {
				best = im.Img
			}
		}
		if best == nil {
			return nil, errors.New("this icon has no image this build can read")
		}
		return best, nil
	}
	tmp, err := os.MkdirTemp("", "monoform-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	png := filepath.Join(tmp, "in.png")
	if _, serr := imaging.ConvertWithSystem(ctx, p, png); serr != nil {
		return nil, fmt.Errorf("not an image this build can read (%v)", serr)
	}
	f, err = os.Open(png)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err = image.Decode(f)
	return img, err
}
