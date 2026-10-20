package imaging

// Animated GIF and WebP: decoded into full frames (disposal and blending
// applied, so each frame is exactly what's on screen) and encoded back.
// GIF output quantises each frame with median cut and dithers it; WebP output
// is lossless (nativewebp). Animated WebP decoding is done here: each ANMF
// frame is re-wrapped as a still WebP for golang.org/x/image/webp.

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"io"
	"sort"

	"github.com/HugoSmits86/nativewebp"
	"golang.org/x/image/webp"
)

// Frame is one full frame and how long it shows (milliseconds).
type Frame struct {
	Image *image.NRGBA
	Delay int
}

// Anim is a decoded animation. Loop 0 = forever, n = play n times.
type Anim struct {
	Width, Height int
	Loop          int
	Frames        []Frame
}

// DecodeAnim decodes a GIF or WebP (animated or still).
func DecodeAnim(b []byte) (*Anim, error) {
	switch {
	case bytes.HasPrefix(b, []byte("GIF8")):
		return decodeGIF(b)
	case len(b) > 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return decodeWebP(b)
	}
	return nil, errors.New("not a GIF or WebP image")
}

func decodeGIF(b []byte) (*Anim, error) {
	g, err := gif.DecodeAll(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	w, h := g.Config.Width, g.Config.Height
	if w == 0 || h == 0 {
		for _, f := range g.Image {
			w = max(w, f.Bounds().Max.X)
			h = max(h, f.Bounds().Max.Y)
		}
	}
	a := &Anim{Width: w, Height: h}
	switch {
	case g.LoopCount == 0:
		a.Loop = 0
	case g.LoopCount < 0:
		a.Loop = 1
	default:
		a.Loop = g.LoopCount + 1
	}
	canvas := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i, f := range g.Image {
		var saved *image.NRGBA
		disp := byte(0)
		if i < len(g.Disposal) {
			disp = g.Disposal[i]
		}
		if disp == gif.DisposalPrevious {
			saved = image.NewNRGBA(canvas.Rect)
			copy(saved.Pix, canvas.Pix)
		}
		draw.Draw(canvas, f.Bounds(), f, f.Bounds().Min, draw.Over)
		out := image.NewNRGBA(canvas.Rect)
		copy(out.Pix, canvas.Pix)
		delay := 100
		if i < len(g.Delay) {
			delay = g.Delay[i] * 10
		}
		if delay < 20 {
			delay = 100 // browsers treat 0–10 ms as 100 ms
		}
		a.Frames = append(a.Frames, Frame{Image: out, Delay: delay})
		switch disp {
		case gif.DisposalBackground:
			draw.Draw(canvas, f.Bounds(), image.Transparent, image.Point{}, draw.Src)
		case gif.DisposalPrevious:
			copy(canvas.Pix, saved.Pix)
		}
	}
	return a, nil
}

type chunk struct {
	id   string
	data []byte
}

func riffChunks(b []byte) ([]chunk, error) {
	var out []chunk
	for p := 0; p+8 <= len(b); {
		id := string(b[p : p+4])
		n := int(binary.LittleEndian.Uint32(b[p+4:]))
		if p+8+n > len(b) || n < 0 {
			return nil, fmt.Errorf("truncated %s chunk", id)
		}
		out = append(out, chunk{id, b[p+8 : p+8+n]})
		p += 8 + n + n&1
	}
	return out, nil
}

func u24(b []byte) int { return int(b[0]) | int(b[1])<<8 | int(b[2])<<16 }

// stillWebP wraps frame chunks (ALPH? + VP8 / VP8L) as a standalone WebP.
func stillWebP(w, h int, parts []chunk) []byte {
	var body bytes.Buffer
	hasAlpha := false
	for _, c := range parts {
		if c.id == "ALPH" {
			hasAlpha = true
		}
	}
	if hasAlpha {
		vp8x := make([]byte, 10)
		vp8x[0] = 0x10 // alpha
		vp8x[4], vp8x[5], vp8x[6] = byte(w-1), byte((w-1)>>8), byte((w-1)>>16)
		vp8x[7], vp8x[8], vp8x[9] = byte(h-1), byte((h-1)>>8), byte((h-1)>>16)
		writeChunk(&body, "VP8X", vp8x)
	}
	for _, c := range parts {
		if c.id == "ALPH" || c.id == "VP8 " || c.id == "VP8L" {
			writeChunk(&body, c.id, c.data)
		}
	}
	var out bytes.Buffer
	out.WriteString("RIFF")
	binary.Write(&out, binary.LittleEndian, uint32(4+body.Len()))
	out.WriteString("WEBP")
	out.Write(body.Bytes())
	return out.Bytes()
}

func writeChunk(w *bytes.Buffer, id string, data []byte) {
	w.WriteString(id)
	binary.Write(w, binary.LittleEndian, uint32(len(data)))
	w.Write(data)
	if len(data)&1 == 1 {
		w.WriteByte(0)
	}
}

func decodeWebP(b []byte) (*Anim, error) {
	n := int(binary.LittleEndian.Uint32(b[4:8]))
	if 8+n > len(b) {
		n = len(b) - 8
	}
	cs, err := riffChunks(b[12 : 8+n])
	if err != nil {
		return nil, err
	}
	var w, h int
	anim := false
	a := &Anim{}
	for _, c := range cs {
		if c.id == "VP8X" && len(c.data) >= 10 {
			anim = c.data[0]&0x02 != 0
			w, h = u24(c.data[4:])+1, u24(c.data[7:])+1
		}
		if c.id == "ANIM" && len(c.data) >= 6 {
			a.Loop = int(binary.LittleEndian.Uint16(c.data[4:]))
		}
	}
	if !anim {
		img, err := webp.Decode(bytes.NewReader(b))
		if err != nil {
			return nil, err
		}
		f := toNRGBA(img)
		return &Anim{Width: f.Rect.Dx(), Height: f.Rect.Dy(), Loop: 0, Frames: []Frame{{Image: f, Delay: 100}}}, nil
	}
	a.Width, a.Height = w, h
	canvas := image.NewNRGBA(image.Rect(0, 0, w, h))
	var prevRect image.Rectangle
	prevDispose := false
	for _, c := range cs {
		if c.id != "ANMF" || len(c.data) < 16 {
			continue
		}
		d := c.data
		x, y := u24(d)*2, u24(d[3:])*2
		fw, fh := u24(d[6:])+1, u24(d[9:])+1
		delay := u24(d[12:])
		flags := d[15]
		blend := flags&0x02 == 0
		dispose := flags&0x01 != 0
		parts, err := riffChunks(d[16:])
		if err != nil {
			return nil, err
		}
		img, err := webp.Decode(bytes.NewReader(stillWebP(fw, fh, parts)))
		if err != nil {
			return nil, fmt.Errorf("frame %d: %w", len(a.Frames)+1, err)
		}
		if prevDispose {
			draw.Draw(canvas, prevRect, image.Transparent, image.Point{}, draw.Src)
		}
		r := image.Rect(x, y, x+fw, y+fh)
		op := draw.Src
		if blend {
			op = draw.Over
		}
		draw.Draw(canvas, r, img, img.Bounds().Min, op)
		out := image.NewNRGBA(canvas.Rect)
		copy(out.Pix, canvas.Pix)
		if delay <= 10 {
			delay = 100
		}
		a.Frames = append(a.Frames, Frame{Image: out, Delay: delay})
		prevRect, prevDispose = r, dispose
	}
	if len(a.Frames) == 0 {
		return nil, errors.New("animated WebP without frames")
	}
	return a, nil
}

// ToNRGBA returns img as an NRGBA image with its origin at 0,0.
func ToNRGBA(img image.Image) *image.NRGBA { return toNRGBA(img) }

func toNRGBA(img image.Image) *image.NRGBA {
	if n, ok := img.(*image.NRGBA); ok && n.Rect.Min == (image.Point{}) {
		return n
	}
	b := img.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Rect, img, b.Min, draw.Src)
	return out
}

// ---------- encoding ----------

// EncodeGIF writes frames as an animated GIF (256 colours per frame, dithered).
func EncodeGIF(w io.Writer, a *Anim) error {
	if len(a.Frames) == 0 {
		return errors.New("no frames")
	}
	g := &gif.GIF{Config: image.Config{Width: a.Width, Height: a.Height}}
	transparent := false
	for _, f := range a.Frames {
		if !opaque(f.Image) {
			transparent = true
			break
		}
	}
	for _, f := range a.Frames {
		pal := medianCut(f.Image, 255, transparent)
		p := image.NewPaletted(image.Rect(0, 0, a.Width, a.Height), pal)
		if transparent {
			// Fully transparent pixels → index 0; the rest dithered.
			op := image.NewNRGBA(f.Image.Rect)
			copy(op.Pix, f.Image.Pix)
			for i := 3; i < len(op.Pix); i += 4 {
				if op.Pix[i] >= 128 {
					op.Pix[i] = 255
				}
			}
			draw.FloydSteinberg.Draw(p, p.Rect, op, image.Point{})
			for i := 0; i < len(p.Pix); i++ {
				if op.Pix[i*4+3] < 128 {
					p.Pix[i] = 0
				}
			}
		} else {
			draw.FloydSteinberg.Draw(p, p.Rect, f.Image, image.Point{})
		}
		g.Image = append(g.Image, p)
		g.Delay = append(g.Delay, max(2, (f.Delay+5)/10))
		if transparent {
			g.Disposal = append(g.Disposal, gif.DisposalBackground)
		} else {
			g.Disposal = append(g.Disposal, gif.DisposalNone)
		}
	}
	switch {
	case a.Loop <= 0:
		g.LoopCount = 0
	case a.Loop == 1:
		g.LoopCount = -1
	default:
		g.LoopCount = a.Loop - 1
	}
	return gif.EncodeAll(w, g)
}

// EncodeWebP writes frames as a lossless animated WebP (a still WebP for one frame).
func EncodeWebP(w io.Writer, a *Anim) error {
	if len(a.Frames) == 0 {
		return errors.New("no frames")
	}
	if len(a.Frames) == 1 {
		return nativewebp.Encode(w, a.Frames[0].Image, nil)
	}
	ani := &nativewebp.Animation{LoopCount: uint16(max(0, a.Loop))}
	// Full frames: with transparency, clear before the next one (else they'd blend).
	dispose := uint(0)
	for _, f := range a.Frames {
		if !opaque(f.Image) {
			dispose = 1
			break
		}
	}
	for _, f := range a.Frames {
		ani.Images = append(ani.Images, f.Image)
		ani.Durations = append(ani.Durations, uint(max(1, f.Delay)))
		ani.Disposals = append(ani.Disposals, dispose)
	}
	return nativewebp.EncodeAll(w, ani, nil)
}

// medianCut builds a palette of at most n colours (+ a transparent entry first).
func medianCut(img *image.NRGBA, n int, transparent bool) color.Palette {
	type box struct{ px [][3]uint8 }
	// Sample at most ~64k pixels.
	step := max(1, len(img.Pix)/4/65536)
	var all [][3]uint8
	for i := 0; i+3 < len(img.Pix); i += 4 * step {
		if img.Pix[i+3] < 128 {
			continue
		}
		all = append(all, [3]uint8{img.Pix[i], img.Pix[i+1], img.Pix[i+2]})
	}
	var pal color.Palette
	if transparent {
		pal = append(pal, color.NRGBA{})
	}
	if len(all) == 0 {
		return append(pal, color.NRGBA{A: 255})
	}
	boxes := []box{{all}}
	for len(boxes) < n {
		// Split the box with the widest channel range.
		bi, bc, br := -1, 0, -1
		for i, b := range boxes {
			if len(b.px) < 2 {
				continue
			}
			for c := 0; c < 3; c++ {
				lo, hi := uint8(255), uint8(0)
				for _, p := range b.px {
					lo = min(lo, p[c])
					hi = max(hi, p[c])
				}
				if r := int(hi) - int(lo); r > br {
					bi, bc, br = i, c, r
				}
			}
		}
		if bi < 0 || br == 0 {
			break
		}
		b := boxes[bi].px
		sort.Slice(b, func(i, j int) bool { return b[i][bc] < b[j][bc] })
		m := len(b) / 2
		boxes[bi] = box{b[:m]}
		boxes = append(boxes, box{b[m:]})
	}
	for _, b := range boxes {
		var r, g, bl int
		for _, p := range b.px {
			r += int(p[0])
			g += int(p[1])
			bl += int(p[2])
		}
		k := max(1, len(b.px))
		pal = append(pal, color.NRGBA{uint8(r / k), uint8(g / k), uint8(bl / k), 255})
	}
	return pal
}

// FrameCount counts the frames of a GIF or WebP without decoding pixels
// (1 for stills and other formats).
func FrameCount(b []byte) int {
	switch {
	case bytes.HasPrefix(b, []byte("GIF8")) && len(b) > 13:
		p := 13
		if b[10]&0x80 != 0 {
			p += 3 << (int(b[10]&7) + 1)
		}
		n := 0
		skip := func() bool { // data sub-blocks
			for p < len(b) {
				s := int(b[p])
				p++
				if s == 0 {
					return true
				}
				p += s
			}
			return false
		}
		for p < len(b) {
			switch b[p] {
			case 0x21: // extension
				p += 2
				if !skip() {
					return max(n, 1)
				}
			case 0x2C: // image
				n++
				if p+10 > len(b) {
					return max(n, 1)
				}
				flags := b[p+9]
				p += 10
				if flags&0x80 != 0 {
					p += 3 << (int(flags&7) + 1)
				}
				p++ // LZW minimum code size
				if !skip() {
					return max(n, 1)
				}
			default: // 0x3B trailer or garbage
				return max(n, 1)
			}
		}
		return max(n, 1)
	case len(b) > 30 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP" && string(b[12:16]) == "VP8X" && b[20]&0x02 != 0:
		cs, err := riffChunks(b[12:])
		if err != nil {
			return 1
		}
		n := 0
		for _, c := range cs {
			if c.id == "ANMF" {
				n++
			}
		}
		return max(n, 1)
	}
	return 1
}
