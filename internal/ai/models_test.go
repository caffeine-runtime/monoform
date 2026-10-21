package ai

import (
	"context"
	"image"
	"image/draw"
	_ "image/jpeg"
	"math"
	"os"
	"testing"
	"time"

	xdraw "golang.org/x/image/draw"
)

// MF_AI_STORE points at a store with the real packs installed (local runs;
// CI doesn't download 1.4 GB of models).
func engineForTest(t *testing.T) *Engine {
	t.Helper()
	dir := os.Getenv("MF_AI_STORE")
	if dir == "" {
		t.Skip("MF_AI_STORE not set")
	}
	return &Engine{Store: Store{Dir: dir}, IdleAfter: time.Minute}
}

// photo returns the astronaut fixture scaled to size×size as RGB bytes.
func photo(t *testing.T, size int) []byte {
	f, err := os.Open("../../scripts/fixture-data/astronaut.jpg")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	src, _, err := image.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	xdraw.BiLinear.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
	rgb := make([]byte, 0, 3*size*size)
	for i := 0; i < len(dst.Pix); i += 4 {
		rgb = append(rgb, dst.Pix[i], dst.Pix[i+1], dst.Pix[i+2])
	}
	return rgb
}

func mean(b []byte, size int, x0, y0, x1, y1, stride, ch int) float64 {
	var s float64
	var n int
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			s += float64(b[(y*size+x)*stride+ch])
			n++
		}
	}
	return s / float64(n)
}

func TestSubjectMaskOnPhoto(t *testing.T) {
	e := engineForTest(t)
	start := time.Now()
	m, err := e.SubjectMask(context.Background(), photo(t, SubjectSize))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("subject mask in %v", time.Since(start))
	// The astronaut's face and suit are subject; the flag (top left) and the
	// backdrop (top right) aren't.
	S := SubjectSize
	if face := mean(m, S, 400, 220, 520, 340, 1, 0); face < 240 {
		t.Errorf("face %.0f", face)
	}
	if suit := mean(m, S, 150, 700, 450, 900, 1, 0); suit < 240 {
		t.Errorf("suit %.0f", suit)
	}
	if flag := mean(m, S, 0, 0, 150, 250, 1, 0); flag > 10 {
		t.Errorf("flag %.0f", flag)
	}
	if back := mean(m, S, 750, 20, 1000, 120, 1, 0); back > 10 {
		t.Errorf("backdrop %.0f", back)
	}
}

func TestEraseOnPhoto(t *testing.T) {
	e := engineForTest(t)
	rgb := photo(t, EraseSize)
	// The model shuttle on the right: a box around it.
	mask := make([]byte, EraseSize*EraseSize)
	for y := 0; y < 290; y++ {
		for x := 350; x < 472; x++ {
			mask[y*EraseSize+x] = 255
		}
	}
	var steps []int
	start := time.Now()
	out, err := e.Erase(context.Background(), rgb, mask, 1, func(d, total int) { steps = append(steps, d) })
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("erased in %v, progress %v", time.Since(start), steps)
	if d := os.Getenv("MF_AI_DUMP"); d != "" {
		os.WriteFile(d, out, 0o644)
	}
	// The shuttle is white and dark brown; the backdrop around it is a soft
	// grey-beige. The fill should look like the backdrop: no dark tank, no
	// bright white.
	dev := 0.0
	ref := [3]float64{}
	for c := 0; c < 3; c++ {
		ref[c] = mean(rgb, EraseSize, 300, 40, 340, 250, 3, c) // backdrop left of it
	}
	for c := 0; c < 3; c++ {
		dev += math.Abs(mean(out, EraseSize, 380, 20, 450, 270, 3, c) - ref[c])
	}
	if dev/3 > 25 {
		t.Errorf("fill differs from the backdrop by %.0f per channel", dev/3)
	}
	// Cancelling stops it.
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(2 * time.Second); cancel() }()
	if _, err := e.Erase(ctx, rgb, mask, 2, nil); err != context.Canceled {
		t.Errorf("cancelled erase: %v", err)
	}
	e.Unload()
	if e.Loaded() != 0 {
		t.Error("models still loaded")
	}
}
