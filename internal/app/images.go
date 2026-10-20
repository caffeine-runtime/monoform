package app

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/caffeine-runtime/hold-it-all/internal/fs"
	"github.com/caffeine-runtime/hold-it-all/internal/imaging"
)

// AnimFrame is one frame on disk (a temp PNG) and its delay in ms.
type AnimFrame struct {
	Path  string `json:"path"`
	Delay int    `json:"delay"`
}

// AnimInfo describes an opened GIF/WebP animation.
type AnimInfo struct {
	Width  int         `json:"width"`
	Height int         `json:"height"`
	Loop   int         `json:"loop"`
	Frames []AnimFrame `json:"frames"`
}

var fastPNG = png.Encoder{CompressionLevel: png.BestSpeed}

// AnimOpen decodes a GIF/WebP into full frames written as temp PNGs.
func (a *App) AnimOpen(path string) (AnimInfo, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return AnimInfo{}, err
	}
	an, err := imaging.DecodeAnim(b)
	if err != nil {
		return AnimInfo{}, err
	}
	dir := a.TempPath("frames")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return AnimInfo{}, err
	}
	info := AnimInfo{Width: an.Width, Height: an.Height, Loop: an.Loop}
	for i, f := range an.Frames {
		p := filepath.Join(dir, fmt.Sprintf("%05d.png", i))
		var buf bytes.Buffer
		if err := fastPNG.Encode(&buf, f.Image); err != nil {
			return AnimInfo{}, err
		}
		if err := os.WriteFile(p, buf.Bytes(), 0o600); err != nil {
			return AnimInfo{}, err
		}
		info.Frames = append(info.Frames, AnimFrame{Path: p, Delay: f.Delay})
	}
	return info, nil
}

func readImage(p string) (image.Image, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	return img, err
}

// AnimSave writes frames (PNG files) as an animated GIF or WebP at dst.
func (a *App) AnimSave(frames []AnimFrame, loop int, dst, format string) error {
	an := &imaging.Anim{Loop: loop}
	for i, f := range frames {
		img, err := readImage(f.Path)
		if err != nil {
			return fmt.Errorf("frame %d: %w", i+1, err)
		}
		n := imaging.ToNRGBA(img)
		if i == 0 {
			an.Width, an.Height = n.Rect.Dx(), n.Rect.Dy()
		}
		an.Frames = append(an.Frames, imaging.Frame{Image: n, Delay: f.Delay})
	}
	var buf bytes.Buffer
	var err error
	switch strings.ToLower(format) {
	case "gif":
		err = imaging.EncodeGIF(&buf, an)
	case "webp":
		err = imaging.EncodeWebP(&buf, an)
	default:
		err = fmt.Errorf("can't save animations as %q", format)
	}
	if err != nil {
		return err
	}
	if err := fs.AtomicWriteReader(dst, &buf); err != nil {
		return err
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(dst)
	}
	return nil
}

// IconEntry is one size inside an .ico/.icns file (Path: a temp PNG, "" if undecodable).
type IconEntry struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"`
	Kind   string `json:"kind"`
	Path   string `json:"path"`
}

// IconOpen lists the images inside an .ico/.cur/.icns file.
func (a *App) IconOpen(path string) ([]IconEntry, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var imgs []imaging.IconImage
	if strings.EqualFold(filepath.Ext(path), ".icns") {
		imgs, err = imaging.DecodeICNS(b)
	} else {
		imgs, err = imaging.DecodeICO(b)
	}
	if err != nil {
		return nil, err
	}
	dir := a.TempPath("icon")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	var out []IconEntry
	for i, im := range imgs {
		e := IconEntry{Width: im.Width, Height: im.Height, Format: im.Format, Kind: im.Kind}
		if im.Img != nil {
			e.Path = filepath.Join(dir, fmt.Sprintf("%02d-%dx%d.png", i, im.Width, im.Height))
			var buf bytes.Buffer
			if err := fastPNG.Encode(&buf, im.Img); err != nil {
				return nil, err
			}
			if err := os.WriteFile(e.Path, buf.Bytes(), 0o600); err != nil {
				return nil, err
			}
		}
		out = append(out, e)
	}
	return out, nil
}

// IconWrite builds an .ico (sizes; empty = the standard set) or .icns from an image file.
func (a *App) IconWrite(src, dst, format string, sizes []int) error {
	img, err := readImage(src)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if strings.EqualFold(format, "icns") {
		err = imaging.EncodeICNS(&buf, img)
	} else {
		err = imaging.EncodeICO(&buf, img, sizes)
	}
	if err != nil {
		return err
	}
	if err := fs.AtomicWriteReader(dst, &buf); err != nil {
		return err
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(dst)
	}
	return nil
}

var sysImages sync.Map // path|mtime|size → converted PNG

// ImageViaSystem converts an image the webview can't show (HEIC/HEIF) to a
// temp PNG with the operating system's decoder, and says which tool did it.
func (a *App) ImageViaSystem(path string) (SystemImage, error) {
	st, err := os.Stat(path)
	if err != nil {
		return SystemImage{}, err
	}
	key := fmt.Sprintf("%s|%d|%d", path, st.ModTime().UnixNano(), st.Size())
	if v, ok := sysImages.Load(key); ok {
		if r := v.(SystemImage); fileExists(r.Path) {
			return r, nil
		}
	}
	dst := a.TempPath(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)) + ".png")
	tool, err := imaging.ConvertWithSystem(context.Background(), path, dst)
	if err != nil {
		return SystemImage{}, err
	}
	r := SystemImage{Path: dst, Tool: tool}
	sysImages.Store(key, r)
	return r, nil
}

// SystemImage is a converted image and the tool that converted it.
type SystemImage struct {
	Path string `json:"path"`
	Tool string `json:"tool"`
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// AnimFrameCount counts frames of a GIF/WebP (1 for stills) without decoding them.
func (a *App) AnimFrameCount(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	// GIF frame headers are spread over the file; WebP's are in the RIFF chunks.
	b, err := io.ReadAll(io.LimitReader(f, 256<<20))
	if err != nil {
		return 0, err
	}
	return imaging.FrameCount(b), nil
}

// ConvertImage writes src (any image the app reads, HEIC/HEIF/AVIF through
// the system decoder) to dst in format (png, jpg, webp, gif, bmp).
func (a *App) ConvertImage(src, dst, format string) error {
	in := src
	img, err := readImage(src)
	if err != nil {
		r, serr := a.ImageViaSystem(src)
		if serr != nil {
			return serr
		}
		in = r.Path
		if img, err = readImage(in); err != nil {
			return err
		}
	}
	var buf bytes.Buffer
	if err := imaging.Encode(&buf, img, imaging.Options{Format: format, Quality: 92}); err != nil {
		return err
	}
	if err := fs.AtomicWriteReader(dst, &buf); err != nil {
		return err
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(dst)
	}
	return nil
}
