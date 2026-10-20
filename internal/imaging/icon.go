package imaging

// Icon files: Windows .ico (PNG or BMP/DIB entries, with the AND mask) and
// macOS .icns (PNG entries, the RLE-compressed legacy is32/il32/ih32/it32
// with their masks, and ARGB ic04/ic05). Reading returns every size;
// writing builds the usual set of sizes from one image as PNG entries.

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"sort"

	"golang.org/x/image/draw"
)

// IconImage is one size inside an icon file. Img is nil when the entry is in
// a format we can't decode (JPEG 2000 in old .icns files).
type IconImage struct {
	Width  int
	Height int
	Format string // png | bmp | rle | argb | jp2
	Kind   string // ICNS chunk type, or "" for ICO
	Img    *image.NRGBA
}

// ---------- ICO ----------

// DecodeICO reads every image in a .ico (or .cur) file.
func DecodeICO(b []byte) ([]IconImage, error) {
	if len(b) < 6 || binary.LittleEndian.Uint16(b) != 0 || (binary.LittleEndian.Uint16(b[2:]) != 1 && binary.LittleEndian.Uint16(b[2:]) != 2) {
		return nil, errors.New("not an ICO file")
	}
	n := int(binary.LittleEndian.Uint16(b[4:]))
	var out []IconImage
	for i := 0; i < n; i++ {
		e := 6 + i*16
		if e+16 > len(b) {
			return nil, errors.New("truncated ICO directory")
		}
		size := int(binary.LittleEndian.Uint32(b[e+8:]))
		off := int(binary.LittleEndian.Uint32(b[e+12:]))
		if off < 0 || size < 0 || off+size > len(b) {
			return nil, fmt.Errorf("entry %d is out of the file", i+1)
		}
		data := b[off : off+size]
		if bytes.HasPrefix(data, []byte("\x89PNG")) {
			img, err := png.Decode(bytes.NewReader(data))
			if err != nil {
				return nil, fmt.Errorf("entry %d: %w", i+1, err)
			}
			n := toNRGBA(img)
			out = append(out, IconImage{Width: n.Rect.Dx(), Height: n.Rect.Dy(), Format: "png", Img: n})
			continue
		}
		img, err := decodeDIB(data)
		if err != nil {
			return nil, fmt.Errorf("entry %d: %w", i+1, err)
		}
		out = append(out, IconImage{Width: img.Rect.Dx(), Height: img.Rect.Dy(), Format: "bmp", Img: img})
	}
	return out, nil
}

// decodeDIB reads an ICO bitmap: BITMAPINFOHEADER, palette, XOR pixels
// (bottom-up) and the 1-bit AND (transparency) mask.
func decodeDIB(d []byte) (*image.NRGBA, error) {
	if len(d) < 40 {
		return nil, errors.New("short bitmap")
	}
	hs := int(binary.LittleEndian.Uint32(d))
	w := int(int32(binary.LittleEndian.Uint32(d[4:])))
	h := int(int32(binary.LittleEndian.Uint32(d[8:]))) / 2
	bpp := int(binary.LittleEndian.Uint16(d[14:]))
	comp := binary.LittleEndian.Uint32(d[16:])
	used := int(binary.LittleEndian.Uint32(d[32:]))
	if w <= 0 || h <= 0 || w > 1024 || h > 1024 || comp != 0 {
		return nil, fmt.Errorf("unsupported bitmap (%dx%d, compression %d)", w, h, comp)
	}
	p := hs
	var pal []color.NRGBA
	if bpp <= 8 {
		if used == 0 {
			used = 1 << bpp
		}
		for i := 0; i < used && p+4 <= len(d); i++ {
			pal = append(pal, color.NRGBA{d[p+2], d[p+1], d[p], 255})
			p += 4
		}
	}
	stride := ((w*bpp + 31) / 32) * 4
	maskStride := ((w + 31) / 32) * 4
	if p+stride*h > len(d) {
		return nil, errors.New("truncated bitmap")
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	hasAlpha := false
	for y := 0; y < h; y++ {
		row := d[p+(h-1-y)*stride:]
		for x := 0; x < w; x++ {
			var c color.NRGBA
			switch bpp {
			case 32:
				c = color.NRGBA{row[x*4+2], row[x*4+1], row[x*4], row[x*4+3]}
				if c.A != 0 {
					hasAlpha = true
				}
			case 24:
				c = color.NRGBA{row[x*3+2], row[x*3+1], row[x*3], 255}
			case 8, 4, 1:
				bit := x * bpp
				v := int(row[bit/8]>>(8-bpp-bit%8)) & (1<<bpp - 1)
				if v < len(pal) {
					c = pal[v]
				}
			default:
				return nil, fmt.Errorf("%d-bit icons aren't supported", bpp)
			}
			img.SetNRGBA(x, y, c)
		}
	}
	// AND mask (when there's no real alpha channel).
	mp := p + stride*h
	if !hasAlpha && mp+maskStride*h <= len(d) {
		for y := 0; y < h; y++ {
			row := d[mp+(h-1-y)*maskStride:]
			for x := 0; x < w; x++ {
				if row[x/8]>>(7-x%8)&1 == 1 {
					img.Pix[(y*w+x)*4+3] = 0
				} else if bpp == 32 {
					img.Pix[(y*w+x)*4+3] = 255
				}
			}
		}
	}
	return img, nil
}

// ICOSizes are the sizes EncodeICO writes by default.
var ICOSizes = []int{16, 24, 32, 48, 64, 128, 256}

// EncodeICO writes src scaled to each size as PNG entries.
func EncodeICO(w io.Writer, src image.Image, sizes []int) error {
	if len(sizes) == 0 {
		sizes = ICOSizes
	}
	sizes = uniqSorted(sizes)
	var datas [][]byte
	for _, s := range sizes {
		if s < 1 || s > 256 {
			return fmt.Errorf("ICO sizes are 1–256 px (got %d)", s)
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, square(src, s)); err != nil {
			return err
		}
		datas = append(datas, buf.Bytes())
	}
	var out bytes.Buffer
	binary.Write(&out, binary.LittleEndian, [3]uint16{0, 1, uint16(len(sizes))})
	off := 6 + 16*len(sizes)
	for i, s := range sizes {
		b := byte(s)
		if s == 256 {
			b = 0
		}
		out.Write([]byte{b, b, 0, 0})
		binary.Write(&out, binary.LittleEndian, [2]uint16{1, 32})
		binary.Write(&out, binary.LittleEndian, [2]uint32{uint32(len(datas[i])), uint32(off)})
		off += len(datas[i])
	}
	for _, d := range datas {
		out.Write(d)
	}
	_, err := w.Write(out.Bytes())
	return err
}

// square scales an image into an s×s square (aspect kept, centred, transparent padding).
func square(src image.Image, s int) *image.NRGBA {
	b := src.Bounds()
	dst := image.NewNRGBA(image.Rect(0, 0, s, s))
	k := float64(s) / float64(max(b.Dx(), b.Dy()))
	w := max(1, int(float64(b.Dx())*k+0.5))
	h := max(1, int(float64(b.Dy())*k+0.5))
	r := image.Rect((s-w)/2, (s-h)/2, (s-w)/2+w, (s-h)/2+h)
	draw.CatmullRom.Scale(dst, r, src, b, draw.Src, nil)
	return dst
}

func uniqSorted(s []int) []int {
	m := map[int]bool{}
	var out []int
	for _, x := range s {
		if !m[x] {
			m[x] = true
			out = append(out, x)
		}
	}
	sort.Ints(out)
	return out
}

// ---------- ICNS ----------

var icnsPNG = map[string]int{"icp4": 16, "icp5": 32, "icp6": 64, "ic07": 128, "ic08": 256, "ic09": 512, "ic10": 1024, "ic11": 32, "ic12": 64, "ic13": 256, "ic14": 512}
var icnsRLE = map[string]struct {
	size int
	mask string
}{"is32": {16, "s8mk"}, "il32": {32, "l8mk"}, "ih32": {48, "h8mk"}, "it32": {128, "t8mk"}}

// DecodeICNS reads every image in a .icns file.
func DecodeICNS(b []byte) ([]IconImage, error) {
	if len(b) < 8 || string(b[:4]) != "icns" {
		return nil, errors.New("not an ICNS file")
	}
	total := min(len(b), int(binary.BigEndian.Uint32(b[4:])))
	chunks := map[string][]byte{}
	var order []string
	for p := 8; p+8 <= total; {
		t := string(b[p : p+4])
		n := int(binary.BigEndian.Uint32(b[p+4:]))
		if n < 8 || p+n > total {
			return nil, fmt.Errorf("bad %q chunk", t)
		}
		chunks[t] = b[p+8 : p+n]
		order = append(order, t)
		p += n
	}
	var out []IconImage
	for _, t := range order {
		d := chunks[t]
		switch {
		case bytes.HasPrefix(d, []byte("\x89PNG")):
			img, err := png.Decode(bytes.NewReader(d))
			if err != nil {
				return nil, fmt.Errorf("%s: %w", t, err)
			}
			n := toNRGBA(img)
			out = append(out, IconImage{Width: n.Rect.Dx(), Height: n.Rect.Dy(), Format: "png", Kind: t, Img: n})
		case bytes.HasPrefix(d, []byte("\x00\x00\x00\x0cjP")) || bytes.HasPrefix(d, []byte("\xff\x4f\xff\x51")):
			s := icnsPNG[t]
			out = append(out, IconImage{Width: s, Height: s, Format: "jp2", Kind: t})
		case (t == "ic04" || t == "ic05") && bytes.HasPrefix(d, []byte("ARGB")):
			s := 16
			if t == "ic05" {
				s = 32
			}
			px, err := unpackRLE(d[4:], s*s, 4)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", t, err)
			}
			img := image.NewNRGBA(image.Rect(0, 0, s, s))
			for i := 0; i < s*s; i++ {
				img.Pix[i*4], img.Pix[i*4+1], img.Pix[i*4+2], img.Pix[i*4+3] = px[s*s+i], px[2*s*s+i], px[3*s*s+i], px[i]
			}
			out = append(out, IconImage{Width: s, Height: s, Format: "argb", Kind: t, Img: img})
		default:
			r, ok := icnsRLE[t]
			if !ok {
				continue // masks, TOC, info, unknown
			}
			s := r.size
			data := d
			if t == "it32" && len(data) >= 4 {
				data = data[4:]
			}
			var px []byte
			if len(data) == s*s*4 {
				// Uncompressed ARGB (seen in some old files).
				px = make([]byte, s*s*3)
				for i := 0; i < s*s; i++ {
					px[i], px[s*s+i], px[2*s*s+i] = data[i*4+1], data[i*4+2], data[i*4+3]
				}
			} else {
				var err error
				if px, err = unpackRLE(data, s*s, 3); err != nil {
					return nil, fmt.Errorf("%s: %w", t, err)
				}
			}
			img := image.NewNRGBA(image.Rect(0, 0, s, s))
			mask := chunks[r.mask]
			for i := 0; i < s*s; i++ {
				a := byte(255)
				if len(mask) >= s*s {
					a = mask[i]
				}
				img.Pix[i*4], img.Pix[i*4+1], img.Pix[i*4+2], img.Pix[i*4+3] = px[i], px[s*s+i], px[2*s*s+i], a
			}
			out = append(out, IconImage{Width: s, Height: s, Format: "rle", Kind: t, Img: img})
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no images in this ICNS file")
	}
	return out, nil
}

// unpackRLE decodes Apple's icon RLE: channels stored one after another.
func unpackRLE(d []byte, n, channels int) ([]byte, error) {
	out := make([]byte, 0, n*channels)
	for p := 0; len(out) < n*channels; {
		if p >= len(d) {
			return nil, errors.New("truncated RLE data")
		}
		c := int(d[p])
		p++
		if c < 0x80 {
			if p+c+1 > len(d) {
				return nil, errors.New("truncated RLE run")
			}
			out = append(out, d[p:p+c+1]...)
			p += c + 1
		} else {
			if p >= len(d) {
				return nil, errors.New("truncated RLE repeat")
			}
			for k := 0; k < c-0x80+3; k++ {
				out = append(out, d[p])
			}
			p++
		}
	}
	return out[:n*channels], nil
}

// ICNSTypes are the entries EncodeICNS writes (all PNG; macOS 10.7+).
var ICNSTypes = []string{"icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"}

// EncodeICNS writes src at every standard size (including @2x) as PNG entries.
func EncodeICNS(w io.Writer, src image.Image) error {
	var body bytes.Buffer
	cache := map[int][]byte{}
	for _, t := range ICNSTypes {
		s := icnsPNG[t]
		d, ok := cache[s]
		if !ok {
			var buf bytes.Buffer
			if err := png.Encode(&buf, square(src, s)); err != nil {
				return err
			}
			d = buf.Bytes()
			cache[s] = d
		}
		body.WriteString(t)
		binary.Write(&body, binary.BigEndian, uint32(8+len(d)))
		body.Write(d)
	}
	var out bytes.Buffer
	out.WriteString("icns")
	binary.Write(&out, binary.BigEndian, uint32(8+body.Len()))
	out.Write(body.Bytes())
	_, err := w.Write(out.Bytes())
	return err
}
