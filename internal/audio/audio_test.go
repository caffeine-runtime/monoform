package audio

import (
	"bytes"
	"context"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// writeWAV writes samples with our encoder (bits 16/24, or 32 float).
func writeWAV(t *testing.T, path string, f Format, samples []float32) {
	t.Helper()
	fh, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	e, err := newWAVEncoder(fh, f, Tags{"title": "Ramp", "artist": "Test"})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Write(samples); err != nil {
		t.Fatal(err)
	}
	if err := e.Close(); err != nil {
		t.Fatal(err)
	}
	fh.Close()
}

func decodeAll(t *testing.T, path string) (Format, []float32) {
	t.Helper()
	d, _, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	f := d.Format()
	var out []float32
	buf := make([]float32, 4096*f.Channels)
	for {
		n, err := d.Read(buf)
		out = append(out, buf[:n*f.Channels]...)
		if err != nil || n == 0 {
			break
		}
	}
	return f, out
}

// frequency estimates a channel's frequency from zero crossings (with
// hysteresis, so codec noise in the padding doesn't count) over the span
// between the first and last crossing.
func frequency(s []float32, ch, c, rate int) float64 {
	n, first, last, pos := 0, -1, 0, false
	for i := c; i < len(s); i += ch {
		if v := s[i]; v > 0.05 && !pos || v < -0.05 && pos {
			pos = v > 0
			if first < 0 {
				first = i / ch
			} else {
				n++
			}
			last = i / ch
		}
	}
	return float64(n) / 2 / (float64(last-first) / float64(rate))
}

func TestDecodeFixtures(t *testing.T) {
	cases := []struct {
		file     string
		codec    Codec
		rate, ch int
		lossless bool
	}{
		{"tone.mp3", MP3, 44100, 2, false},
		{"tone.flac", FLAC, 44100, 2, true},
		{"tone.ogg", Vorbis, 44100, 2, false},
		{"mono22.mp3", MP3, 22050, 1, false},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			p := filepath.Join("testdata", c.file)
			info, pic, err := Probe(p)
			if err != nil {
				t.Fatal(err)
			}
			if info.Codec != c.codec || info.SampleRate != c.rate || info.Channels != c.ch || info.Lossless != c.lossless || !info.Editable {
				t.Fatalf("info %+v", info)
			}
			if info.Duration < 0.99 || info.Duration > 1.1 {
				t.Errorf("duration %.3f", info.Duration)
			}
			f, s := decodeAll(t, p)
			if got := int64(len(s) / f.Channels); got < f.Frames-2048 || got > f.Frames {
				t.Errorf("decoded %d frames, header says %d", got, f.Frames)
			}
			if fr := frequency(s, f.Channels, 0, f.SampleRate); math.Abs(fr-440) > 15 {
				t.Errorf("left %.0f Hz, want 440", fr)
			}
			if f.Channels == 2 {
				if fr := frequency(s, 2, 1, f.SampleRate); math.Abs(fr-660) > 15 {
					t.Errorf("right %.0f Hz, want 660", fr)
				}
			}
			if c.file != "mono22.mp3" {
				if info.Tags["title"] != "Tone" || info.Tags["artist"] != "Fixture" || info.Tags["track"] != "3" {
					t.Errorf("tags %v", info.Tags)
				}
			}
			if c.codec != Vorbis && c.file != "mono22.mp3" && (pic == nil || !bytes.HasPrefix(pic.Data, []byte("\x89PNG"))) {
				t.Errorf("cover missing")
			}
			// Seeking lands where reading from the start would.
			d, _, _ := Open(p)
			defer d.Close()
			if err := d.SeekFrame(20000); err != nil {
				t.Fatal(err)
			}
			buf := make([]float32, 64*f.Channels)
			readFull(d, buf)
			want := s[20000*f.Channels : 20064*f.Channels]
			for i := range buf {
				if math.Abs(float64(buf[i]-want[i])) > 1e-4 {
					t.Fatalf("after seek sample %d = %f, want %f", i, buf[i], want[i])
				}
			}
		})
	}
}

func TestUnsupported(t *testing.T) {
	info, _, err := Probe(filepath.Join("testdata", "tone.opus"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Editable || info.Reason == "" {
		t.Fatalf("opus should be play-only: %+v", info)
	}
}

func TestWAVRoundTripAndBitExactCuts(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "ramp.wav")
	const n = 10000
	s := make([]float32, n*2)
	for i := 0; i < n; i++ {
		s[i*2] = float32(int16(i*7%65536-32768)) / 32768
		s[i*2+1] = float32(int16(-i*3%32768)) / 32768
	}
	writeWAV(t, src, Format{SampleRate: 8000, Channels: 2, BitDepth: 16}, s)
	f, got := decodeAll(t, src)
	if f.Frames != n || f.BitDepth != 16 || !equal(got, s) {
		t.Fatalf("16-bit round trip differs (frames %d)", f.Frames)
	}
	info, _, _ := Probe(src)
	if info.Tags["title"] != "Ramp" || info.Tags["artist"] != "Test" {
		t.Errorf("INFO tags %v", info.Tags)
	}
	// Reorder two ranges: unity segments must be bit-exact (no dither).
	segs := []Segment{{Start: 6000, End: 8000}, {Start: 1000, End: 3000}}
	out := filepath.Join(dir, "cut.wav")
	if err := Export(context.Background(), src, segs, out, ExportOptions{Format: "wav"}, nil); err != nil {
		t.Fatal(err)
	}
	_, cut := decodeAll(t, out)
	want := append(append([]float32{}, s[6000*2:8000*2]...), s[1000*2:3000*2]...)
	if !equal(cut, want) {
		t.Fatal("cut is not bit-exact")
	}
	// In-place save (dest == src).
	if err := Export(context.Background(), src, []Segment{{Start: 0, End: 500}}, src, ExportOptions{Format: "wav"}, nil); err != nil {
		t.Fatal(err)
	}
	if f, _ := decodeAll(t, src); f.Frames != 500 {
		t.Fatalf("in-place save: %d frames", f.Frames)
	}
}

func equal(a, b []float32) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestRenderGainSilenceAndPadding(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "dc.wav")
	s := make([]float32, 1000)
	for i := range s {
		s[i] = 0.5
	}
	writeWAV(t, src, Format{SampleRate: 1000, Channels: 1, BitDepth: 32, Float: true}, s)
	d, _, err := Open(src)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	segs := []Segment{
		{Start: 0, End: 100, Gains: []Ramp{{0, 1}}},             // fade in
		{Start: 100, End: 200, Gains: []Ramp{{2, 2}, {0.5, 0.5}}}, // gains multiply
		{Start: 0, End: 50, Silence: true},
		{Start: 950, End: 1050}, // past the end: padded
	}
	var out []float32
	if err := Render(context.Background(), d, segs, func(b []float32) error { out = append(out, b...); return nil }, nil); err != nil {
		t.Fatal(err)
	}
	if len(out) != 350 {
		t.Fatalf("length %d, want 350", len(out))
	}
	near := func(i int, want float32) {
		if math.Abs(float64(out[i]-want)) > 1e-5 {
			t.Errorf("sample %d = %f, want %f", i, out[i], want)
		}
	}
	near(0, 0)
	near(50, 0.25)
	near(150, 0.5)
	near(220, 0)
	near(260, 0.5)
	near(320, 0)
	if p, _ := Analyze(context.Background(), src, segs[1:2], nil); math.Abs(float64(p-0.5)) > 1e-6 {
		t.Errorf("peak %f", p)
	}
}

func TestFLACExport(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "in.wav")
	const n = 20000
	s := make([]float32, n*2)
	for i := 0; i < n; i++ {
		v := 0.6 * math.Sin(float64(i)*2*math.Pi*440/48000)
		q := float32(math.Round(v*8388607)) / 8388608 // exact 24-bit values
		s[i*2], s[i*2+1] = q, -float32(math.Round(v*4194303))/8388608
	}
	writeWAV(t, src, Format{SampleRate: 48000, Channels: 2, BitDepth: 24}, s)
	out := filepath.Join(dir, "out.flac")
	if err := Export(context.Background(), src, []Segment{{Start: 0, End: n}}, out, ExportOptions{Format: "flac"}, nil); err != nil {
		t.Fatal(err)
	}
	f, got := decodeAll(t, out)
	if f.BitDepth != 24 || f.Frames != n || !equal(got, s) {
		t.Fatalf("FLAC not lossless: depth %d frames %d", f.BitDepth, f.Frames)
	}
	if st, _ := os.Stat(out); st.Size() > int64(n*2*3)*7/10 {
		t.Errorf("FLAC barely compressed: %d bytes", st.Size())
	}
	info, _, _ := Probe(out)
	if info.Tags["title"] != "Ramp" {
		t.Errorf("tags not carried into FLAC: %v", info.Tags)
	}
	// Lossy source with cover → FLAC keeps tags and cover.
	out2 := filepath.Join(dir, "tone.flac")
	if err := Export(context.Background(), filepath.Join("testdata", "tone.mp3"), []Segment{{Start: 0, End: 22050}}, out2, ExportOptions{Format: "flac"}, nil); err != nil {
		t.Fatal(err)
	}
	info2, pic, _ := Probe(out2)
	if info2.Tags["artist"] != "Fixture" || pic == nil || info2.BitDepth != 16 || info2.Frames != 22050 {
		t.Errorf("mp3 → flac: %+v pic %v", info2, pic != nil)
	}
}

func TestMP3LosslessCut(t *testing.T) {
	for _, file := range []string{"tone.mp3", "mono22.mp3"} {
		src := filepath.Join("testdata", file)
		fh, _ := os.Open(src)
		idx, err := indexMP3(fh)
		fh.Close()
		if err != nil {
			t.Fatal(err)
		}
		d, _, _ := Open(src)
		frames := d.Format().Frames
		d.Close()
		if int64(len(idx.frames)*idx.spf) != frames {
			t.Fatalf("%s: %d frames × %d ≠ decoder length %d (info frame %d)", file, len(idx.frames), idx.spf, frames, idx.infoFrame)
		}
		spf := int64(idx.spf)
		out := filepath.Join(t.TempDir(), "cut.mp3")
		segs := []Segment{{Start: 10 * spf, End: 20 * spf}, {Start: 30 * spf, End: 35 * spf}}
		if err := Export(context.Background(), src, segs, out, ExportOptions{Format: "mp3"}, nil); err != nil {
			t.Fatal(err)
		}
		oh, _ := os.Open(out)
		cut, err := indexMP3(oh)
		oh.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(cut.frames) != 15 || cut.infoFrame != -1 || len(cut.id3v2) != len(idx.id3v2) {
			t.Fatalf("%s: cut has %d frames (info %d, id3 %d)", file, len(cut.frames), cut.infoFrame, len(cut.id3v2))
		}
		if _, s := decodeAll(t, out); len(s) == 0 {
			t.Fatal("cut doesn't decode")
		}
	}
	if CanCutLosslessly([]Segment{{Start: 0, End: 10, Gains: []Ramp{{1, 0.5}}}}) {
		t.Error("a fade is not a lossless cut")
	}
}

func TestPeaks(t *testing.T) {
	d, _, err := Open(filepath.Join("testdata", "tone.flac"))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	var all []int16
	if err := Peaks(context.Background(), d, func(b []int16) { all = append(all, b...) }); err != nil {
		t.Fatal(err)
	}
	want := int((d.Format().Frames + PeakFrames - 1) / PeakFrames)
	if len(all) != want*4 {
		t.Fatalf("%d values, want %d buckets × 4", len(all), want)
	}
	if all[40] > -3000 || all[41] < 3000 { // ffmpeg's sine source is at 1/8 amplitude
		t.Errorf("bucket 10 left min/max %d/%d, want a loud sine", all[40], all[41])
	}
}

func TestPeaksFileMatchesSequential(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "long.wav")
	const n = PeakFrames * 4096 * 5
	s := make([]float32, n)
	for i := range s {
		s[i] = float32(math.Sin(float64(i)*0.01)) * float32(i%977) / 977
	}
	writeWAV(t, src, Format{SampleRate: 48000, Channels: 1, BitDepth: 16}, s)
	d, _, _ := Open(src)
	var seq, par []int16
	Peaks(context.Background(), d, func(b []int16) { seq = append(seq, b...) })
	d.Close()
	if err := PeaksFile(context.Background(), src, func(b []int16) { par = append(par, b...) }); err != nil {
		t.Fatal(err)
	}
	if len(seq) != len(par) {
		t.Fatalf("parallel %d values, sequential %d", len(par), len(seq))
	}
	for i := range seq {
		if seq[i] != par[i] {
			t.Fatalf("value %d differs: %d vs %d", i, par[i], seq[i])
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := PeaksFile(ctx, src, func([]int16) {}); err == nil {
		t.Error("cancelled run returned no error")
	}
}
