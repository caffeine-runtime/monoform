package imaging

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"testing"
)

func testAnim(alpha bool) *Anim {
	a := &Anim{Width: 40, Height: 30, Loop: 0}
	cols := []color.NRGBA{{220, 30, 30, 255}, {30, 200, 60, 255}, {40, 60, 220, 255}}
	for i, c := range cols {
		m := image.NewNRGBA(image.Rect(0, 0, 40, 30))
		bg := color.NRGBA{250, 250, 250, 255}
		if alpha {
			bg = color.NRGBA{}
		}
		draw.Draw(m, m.Rect, &image.Uniform{bg}, image.Point{}, draw.Src)
		draw.Draw(m, image.Rect(i*10, 5, i*10+12, 17), &image.Uniform{c}, image.Point{}, draw.Src)
		a.Frames = append(a.Frames, Frame{Image: m, Delay: 100 * (i + 1)})
	}
	return a
}

func near(t *testing.T, what string, got color.Color, want color.NRGBA, tol int) {
	t.Helper()
	g := color.NRGBAModel.Convert(got).(color.NRGBA)
	d := func(a, b uint8) int {
		if a > b {
			return int(a - b)
		}
		return int(b - a)
	}
	if d(g.R, want.R) > tol || d(g.G, want.G) > tol || d(g.B, want.B) > tol || d(g.A, want.A) > tol {
		t.Errorf("%s: got %v, want %v", what, g, want)
	}
}

func TestGIFRoundTrip(t *testing.T) {
	for _, alpha := range []bool{false, true} {
		var buf bytes.Buffer
		if err := EncodeGIF(&buf, testAnim(alpha)); err != nil {
			t.Fatal(err)
		}
		if n := FrameCount(buf.Bytes()); n != 3 {
			t.Errorf("GIF frame count %d", n)
		}
		a, err := DecodeAnim(buf.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		if len(a.Frames) != 3 || a.Width != 40 || a.Height != 30 || a.Loop != 0 {
			t.Fatalf("decoded %d frames %dx%d loop %d", len(a.Frames), a.Width, a.Height, a.Loop)
		}
		for i, f := range a.Frames {
			if f.Delay != 100*(i+1) {
				t.Errorf("frame %d delay %d", i, f.Delay)
			}
		}
		near(t, "frame 2 square", a.Frames[1].Image.At(15, 10), color.NRGBA{30, 200, 60, 255}, 24)
		if alpha {
			// Frame 3: where frame 1's square was is transparent again (disposal applied).
			near(t, "disposed", a.Frames[2].Image.At(2, 10), color.NRGBA{}, 0)
		} else {
			near(t, "background", a.Frames[2].Image.At(2, 10), color.NRGBA{250, 250, 250, 255}, 24)
		}
	}
}

func TestWebPAnimationRoundTrip(t *testing.T) {
	src := testAnim(true)
	src.Loop = 3
	var buf bytes.Buffer
	if err := EncodeWebP(&buf, src); err != nil {
		t.Fatal(err)
	}
	a, err := DecodeAnim(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Frames) != 3 || a.Loop != 3 || a.Width != 40 {
		t.Fatalf("decoded %d frames loop %d width %d", len(a.Frames), a.Loop, a.Width)
	}
	for i, f := range a.Frames {
		if f.Delay != 100*(i+1) {
			t.Errorf("frame %d delay %d", i, f.Delay)
		}
		// Lossless: every pixel matches.
		if !bytes.Equal(f.Image.Pix, src.Frames[i].Image.Pix) {
			t.Errorf("frame %d pixels differ", i)
		}
	}
	// A still WebP decodes as one frame.
	var one bytes.Buffer
	if err := EncodeWebP(&one, &Anim{Width: 40, Height: 30, Frames: src.Frames[:1]}); err != nil {
		t.Fatal(err)
	}
	s, err := DecodeAnim(one.Bytes())
	if err != nil || len(s.Frames) != 1 {
		t.Fatalf("still: %v %v", s, err)
	}
	if FrameCount(buf.Bytes()) != 3 || FrameCount(one.Bytes()) != 1 {
		t.Errorf("WebP frame counts %d %d", FrameCount(buf.Bytes()), FrameCount(one.Bytes()))
	}
	if _, err := DecodeAnim([]byte("nope")); err == nil {
		t.Error("garbage accepted")
	}
}
