package audio

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

// PeakFrames is how many sample frames one waveform bucket covers.
const PeakFrames = 256

// Peaks decodes the whole stream and emits, per bucket of PeakFrames frames,
// the min and max of up to two channels as int16 (lane-major pairs:
// [min0, max0, min1, max1] for stereo).
func Peaks(ctx context.Context, d Decoder, emit func(buckets []int16)) error {
	return peaksRange(ctx, d, -1, emit)
}

// peaksRange is Peaks for at most limit frames from the current position
// (limit < 0: to the end).
func peaksRange(ctx context.Context, d Decoder, limit int64, emit func(buckets []int16)) error {
	f := d.Format()
	ch, lanes := f.Channels, min(f.Channels, 2)
	buf := make([]float32, PeakFrames*256*ch)
	out := make([]int16, 0, 256*lanes*2)
	q := func(v float32) int16 { return int16(math.Round(float64(clamp(v)) * 32767)) }
	for limit != 0 {
		if limit > 0 && int64(len(buf)/ch) > limit {
			buf = buf[:limit*int64(ch)]
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		n, err := readFull(d, buf)
		for b := 0; b*PeakFrames < n; b++ {
			lo, hi := [2]float32{1, 1}, [2]float32{-1, -1}
			end := min(n, (b+1)*PeakFrames)
			for i := b * PeakFrames; i < end; i++ {
				for l := 0; l < lanes; l++ {
					v := buf[i*ch+l]
					lo[l], hi[l] = min(lo[l], v), max(hi[l], v)
				}
			}
			for l := 0; l < lanes; l++ {
				out = append(out, q(lo[l]), q(hi[l]))
			}
		}
		if len(out) > 0 {
			emit(out)
			out = out[:0]
		}
		if limit > 0 {
			limit -= int64(n)
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
	return nil
}

// PeaksFile computes a file's peaks using every core: the file is split into
// chunks (on bucket boundaries) decoded by separate decoders, and chunks are
// emitted in order so a waveform still fills from the left.
func PeaksFile(ctx context.Context, path string, emit func(buckets []int16)) error {
	d, codec, err := Open(path)
	if err != nil {
		return err
	}
	frames := d.Format().Frames
	workers := min(runtime.NumCPU(), 8)
	const minChunk = PeakFrames * 4096 // ~20 s at 48 kHz
	// FLAC files without a seek table make the first seek scan the whole
	// file, so chunks wouldn't save anything; FLAC decodes fast anyway.
	if frames < 2*minChunk || workers < 2 || codec == FLAC {
		defer d.Close()
		return Peaks(ctx, d, emit)
	}
	d.Close()
	chunk := max(minChunk, (frames/int64(workers*4)+PeakFrames-1)/PeakFrames*PeakFrames)
	n := int((frames + chunk - 1) / chunk)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make([]chan []int16, n)
	for i := range results {
		results[i] = make(chan []int16, 1)
	}
	errs := make(chan error, workers)
	next := make(chan int)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var d Decoder
			defer func() {
				if d != nil {
					d.Close()
				}
			}()
			for i := range next {
				if d == nil {
					var err error
					if d, _, err = Open(path); err != nil {
						errs <- err
						cancel()
						return
					}
				}
				var out []int16
				err := d.SeekFrame(int64(i) * chunk)
				if err == nil {
					err = peaksRange(ctx, d, chunk, func(b []int16) { out = append(out, b...) })
				}
				if err != nil {
					errs <- err
					cancel()
					return
				}
				results[i] <- out
			}
		}()
	}
	go func() {
		defer close(next)
		for i := 0; i < n; i++ {
			select {
			case next <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	var ferr error
	for i := 0; i < n && ferr == nil; i++ {
		select {
		case out := <-results[i]:
			emit(out)
		case ferr = <-errs:
		case <-ctx.Done():
			ferr = ctx.Err()
		}
	}
	cancel()
	wg.Wait()
	return ferr
}

// Ramp is a linear gain change across a segment (amplitude factors).
type Ramp struct {
	G0 float32 `json:"g0"`
	G1 float32 `json:"g1"`
}

// Segment is a piece of the edited timeline: source frames [Start, End), or
// End-Start frames of silence. Gains multiply.
type Segment struct {
	Start   int64  `json:"start"`
	End     int64  `json:"end"`
	Silence bool   `json:"silence,omitempty"`
	Gains   []Ramp `json:"gains,omitempty"`
}

func (s Segment) len() int64 { return max(0, s.End-s.Start) }

// unity reports whether a segment plays the source unchanged.
func (s Segment) unity() bool {
	for _, g := range s.Gains {
		if g.G0 != 1 || g.G1 != 1 {
			return false
		}
	}
	return !s.Silence
}

// Length is the edited timeline's length in frames.
func Length(segs []Segment) int64 {
	var n int64
	for _, s := range segs {
		n += s.len()
	}
	return n
}

// Render plays the segments through sink in chunks (interleaved samples).
// A segment reaching past the end of the source is padded with silence so
// the timeline length is exact.
func Render(ctx context.Context, d Decoder, segs []Segment, sink func([]float32) error, progress func(done, total int64)) error {
	ch := d.Format().Channels
	const chunk = 8192
	buf := make([]float32, chunk*ch)
	total, done := Length(segs), int64(0)
	for _, s := range segs {
		L := s.len()
		if L == 0 {
			continue
		}
		if !s.Silence {
			if err := d.SeekFrame(s.Start); err != nil {
				return err
			}
		}
		eof := s.Silence
		for off := int64(0); off < L; {
			if err := ctx.Err(); err != nil {
				return err
			}
			n := int(min(chunk, L-off))
			got := 0
			if !eof {
				var err error
				got, err = readFull(d, buf[:n*ch])
				if err != nil && !errors.Is(err, io.EOF) {
					return err
				}
				eof = got < n
			}
			clear(buf[got*ch : n*ch])
			if len(s.Gains) > 0 && got > 0 {
				for i := 0; i < got; i++ {
					t := float32(off+int64(i)) / float32(L)
					g := float32(1)
					for _, r := range s.Gains {
						g *= r.G0 + (r.G1-r.G0)*t
					}
					for c := 0; c < ch; c++ {
						buf[i*ch+c] *= g
					}
				}
			}
			if err := sink(buf[:n*ch]); err != nil {
				return err
			}
			off += int64(n)
			done += int64(n)
			if progress != nil {
				progress(done, total)
			}
		}
	}
	return nil
}

// Analyze returns the peak amplitude of the edited audio (for normalizing).
func Analyze(ctx context.Context, src string, segs []Segment, progress func(done, total int64)) (float32, error) {
	d, _, err := Open(src)
	if err != nil {
		return 0, err
	}
	defer d.Close()
	var peak float32
	err = Render(ctx, d, segs, func(b []float32) error {
		for _, v := range b {
			peak = max(peak, float32(math.Abs(float64(v))))
		}
		return nil
	}, progress)
	return peak, err
}

// encoder is a sink that writes a file format.
type encoder interface {
	Write([]float32) error
	Close() error
}

// ExportOptions picks the output.
type ExportOptions struct {
	Format   string `json:"format"`   // "wav", "flac" or "mp3" (lossless cut of an MP3 source)
	BitDepth int    `json:"bitDepth"` // 0: keep the source's (16 for lossy sources)
}

// CanCutLosslessly reports whether the edits are only cuts/reorders, so an
// MP3 can be saved without re-encoding.
func CanCutLosslessly(segs []Segment) bool {
	for _, s := range segs {
		if !s.unity() {
			return false
		}
	}
	return len(segs) > 0
}

// Export renders the edits of src into dest, atomically (a temp file in the
// destination folder is renamed over dest at the end), so dest may be src.
func Export(ctx context.Context, src string, segs []Segment, dest string, opt ExportOptions, progress func(done, total int64)) error {
	tmp, err := os.CreateTemp(filepath.Dir(dest), "."+filepath.Base(dest)+".*.tmp")
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	if opt.Format == "mp3" {
		if !CanCutLosslessly(segs) {
			return errors.New("MP3 can only be saved after cuts; fades, gain and silence need WAV or FLAC")
		}
		ranges := make([][2]int64, len(segs))
		for i, s := range segs {
			ranges[i] = [2]int64{s.Start, s.End}
		}
		if err := cutMP3(src, ranges, tmp, progress); err != nil {
			return err
		}
	} else {
		info, pic, err := Probe(src)
		if err != nil {
			return err
		}
		d, codec, err := Open(src)
		if err != nil {
			return err
		}
		f := d.Format()
		out := f
		switch {
		case opt.BitDepth > 0:
			out.BitDepth, out.Float = opt.BitDepth, false
		case codec != WAV && codec != FLAC:
			out.BitDepth, out.Float = 16, false
		case out.BitDepth == 0:
			out.BitDepth = 16
		}
		var enc encoder
		switch opt.Format {
		case "wav":
			if out.Float && out.BitDepth == 64 {
				out.BitDepth = 32
			}
			enc, err = newWAVEncoder(tmp, out, info.Tags)
		case "flac":
			enc, err = newFLACEncoder(tmp, out, info.Tags, pic)
		default:
			err = fmt.Errorf("unknown format %q", opt.Format)
		}
		if err == nil {
			err = Render(ctx, d, segs, enc.Write, progress)
			if cerr := enc.Close(); err == nil {
				err = cerr
			}
		}
		d.Close()
		if err != nil {
			return err
		}
	}
	mode := os.FileMode(0o644)
	if st, err := os.Stat(dest); err == nil {
		mode = st.Mode().Perm()
	}
	if err := tmp.Chmod(mode); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), dest); err != nil {
		return err
	}
	ok = true
	return nil
}
