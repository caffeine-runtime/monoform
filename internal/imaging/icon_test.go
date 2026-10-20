package imaging

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/draw"
	"testing"
)

func logo() *image.NRGBA {
	m := image.NewNRGBA(image.Rect(0, 0, 300, 200))
	draw.Draw(m, m.Rect, &image.Uniform{color.NRGBA{20, 120, 220, 255}}, image.Point{}, draw.Src)
	return m
}

func TestICORoundTrip(t *testing.T) {
	var buf bytes.Buffer
	if err := EncodeICO(&buf, logo(), nil); err != nil {
		t.Fatal(err)
	}
	imgs, err := DecodeICO(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(imgs) != len(ICOSizes) {
		t.Fatalf("%d entries", len(imgs))
	}
	for i, im := range imgs {
		if im.Width != ICOSizes[i] || im.Height != ICOSizes[i] || im.Format != "png" {
			t.Errorf("entry %d: %dx%d %s", i, im.Width, im.Height, im.Format)
		}
	}
	big := imgs[len(imgs)-1].Img
	// 300×200 in a 256 square: padded top and bottom, opaque in the middle.
	near(t, "padding", big.At(128, 5), color.NRGBA{}, 0)
	near(t, "middle", big.At(128, 128), color.NRGBA{20, 120, 220, 255}, 2)
	if err := EncodeICO(&buf, logo(), []int{512}); err == nil {
		t.Error("512 px ICO entry accepted")
	}
}

// A classic BMP-style ICO: one 2×2 4-bit entry with an AND mask, one 32-bit entry.
func TestICOBitmaps(t *testing.T) {
	dib4 := func() []byte {
		var d bytes.Buffer
		binary.Write(&d, binary.LittleEndian, []uint32{40, 2, 4})
		binary.Write(&d, binary.LittleEndian, []uint16{1, 4})
		binary.Write(&d, binary.LittleEndian, []uint32{0, 0, 0, 0, 2, 0})
		d.Write([]byte{0, 0, 255, 0, 255, 0, 0, 0}) // palette: red, blue (BGRx)
		// Rows bottom-up, 4 bytes each: bottom row = blue, red; top row = red, red.
		d.Write([]byte{0x10, 0, 0, 0, 0x00, 0, 0, 0})
		// AND mask rows bottom-up: bottom row opaque, top row: second pixel transparent.
		d.Write([]byte{0x00, 0, 0, 0, 0x40, 0, 0, 0})
		return d.Bytes()
	}()
	dib32 := func() []byte {
		var d bytes.Buffer
		binary.Write(&d, binary.LittleEndian, []uint32{40, 1, 2})
		binary.Write(&d, binary.LittleEndian, []uint16{1, 32})
		binary.Write(&d, binary.LittleEndian, []uint32{0, 0, 0, 0, 0, 0})
		d.Write([]byte{10, 20, 30, 128}) // BGRA
		d.Write([]byte{0, 0, 0, 0})      // AND mask row
		return d.Bytes()
	}()
	var f bytes.Buffer
	binary.Write(&f, binary.LittleEndian, []uint16{0, 1, 2})
	off := 6 + 32
	for _, d := range [][]byte{dib4, dib32} {
		f.Write([]byte{2, 2, 0, 0})
		binary.Write(&f, binary.LittleEndian, []uint16{1, 4})
		binary.Write(&f, binary.LittleEndian, []uint32{uint32(len(d)), uint32(off)})
		off += len(d)
	}
	f.Write(dib4)
	f.Write(dib32)
	imgs, err := DecodeICO(f.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	a := imgs[0].Img
	near(t, "top-left", a.At(0, 0), color.NRGBA{255, 0, 0, 255}, 0)
	near(t, "top-right masked", a.At(1, 0), color.NRGBA{255, 0, 0, 0}, 0)
	near(t, "bottom-left", a.At(0, 1), color.NRGBA{0, 0, 255, 255}, 0)
	near(t, "32-bit pixel", imgs[1].Img.At(0, 0), color.NRGBA{30, 20, 10, 128}, 0)
}

func TestICNSRoundTripAndRLE(t *testing.T) {
	var buf bytes.Buffer
	if err := EncodeICNS(&buf, logo()); err != nil {
		t.Fatal(err)
	}
	imgs, err := DecodeICNS(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(imgs) != len(ICNSTypes) || imgs[6].Width != 1024 || imgs[6].Kind != "ic10" {
		t.Fatalf("%d entries, #7 %dx%d %s", len(imgs), imgs[6].Width, imgs[6].Height, imgs[6].Kind)
	}
	// Legacy is32 (16×16 RLE RGB) + s8mk mask: red, green, blue planes as long runs.
	rle := func(v byte, n int) []byte {
		var out []byte
		for n > 0 {
			k := min(n, 130)
			out = append(out, byte(0x80+k-3), v)
			n -= k
		}
		return out
	}
	var data []byte
	data = append(data, rle(200, 256)...)
	data = append(data, rle(100, 256)...)
	data = append(data, rle(50, 256)...)
	mask := bytes.Repeat([]byte{77}, 256)
	var f bytes.Buffer
	f.WriteString("icns")
	binary.Write(&f, binary.BigEndian, uint32(8+8+len(data)+8+len(mask)))
	f.WriteString("is32")
	binary.Write(&f, binary.BigEndian, uint32(8+len(data)))
	f.Write(data)
	f.WriteString("s8mk")
	binary.Write(&f, binary.BigEndian, uint32(8+len(mask)))
	f.Write(mask)
	old, err := DecodeICNS(f.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(old) != 1 || old[0].Width != 16 || old[0].Format != "rle" {
		t.Fatalf("legacy: %+v", old)
	}
	near(t, "rle pixel", old[0].Img.At(7, 9), color.NRGBA{200, 100, 50, 77}, 0)
	if _, err := DecodeICNS([]byte("nope")); err == nil {
		t.Error("garbage accepted")
	}
}
