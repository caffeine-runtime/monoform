package audio

import (
	"bufio"
	"errors"
	"io"
	"math"
	"os"
	"strings"

	"github.com/mewkiz/flac"
	"github.com/mewkiz/flac/frame"
	"github.com/mewkiz/flac/meta"
)

// --- decoding ---

type flacDecoder struct {
	f      *os.File
	s      *flac.Stream
	format Format
	scale  float32
	frame  *frame.Frame // current frame and read position in it
	fpos   int
	pos    int64
}

func newFLACDecoder(f *os.File) (*flacDecoder, error) {
	s, err := flac.NewSeek(f)
	if err != nil {
		return nil, err
	}
	frames := int64(s.Info.NSamples)
	if frames == 0 {
		frames = -1
	}
	return &flacDecoder{f: f, s: s, scale: float32(math.Ldexp(1, int(s.Info.BitsPerSample)-1)), format: Format{
		SampleRate: int(s.Info.SampleRate), Channels: int(s.Info.NChannels), BitDepth: int(s.Info.BitsPerSample), Frames: frames,
	}}, nil
}

func (d *flacDecoder) Format() Format { return d.format }
func (d *flacDecoder) Close() error   { return d.f.Close() }

func (d *flacDecoder) SeekFrame(fr int64) error {
	fr = max(fr, 0)
	if d.format.Frames >= 0 {
		fr = min(fr, d.format.Frames)
	}
	d.frame, d.fpos = nil, 0
	if d.format.Frames >= 0 && fr == d.format.Frames {
		d.pos = fr
		return nil
	}
	// Seek lands on the start of the frame containing fr; skip the rest.
	at, err := d.s.Seek(uint64(fr))
	if err != nil {
		return err
	}
	d.pos = int64(at)
	if skip := fr - int64(at); skip > 0 {
		if err := d.next(); err != nil {
			return err
		}
		d.fpos = int(min(skip, int64(d.frame.Subframes[0].NSamples)))
		d.pos += int64(d.fpos)
	}
	return nil
}

func (d *flacDecoder) next() error {
	f, err := d.s.ParseNext()
	if err != nil {
		return err
	}
	d.frame, d.fpos = f, 0
	return nil
}

func (d *flacDecoder) Read(dst []float32) (int, error) {
	ch := d.format.Channels
	want := len(dst) / ch
	got := 0
	for got < want {
		if d.frame == nil || d.fpos >= d.frame.Subframes[0].NSamples {
			if err := d.next(); err != nil {
				if got > 0 {
					break
				}
				if errors.Is(err, io.EOF) {
					return 0, io.EOF
				}
				return 0, err
			}
		}
		n := min(want-got, d.frame.Subframes[0].NSamples-d.fpos)
		for c := 0; c < ch; c++ {
			src := d.frame.Subframes[c].Samples[d.fpos : d.fpos+n]
			for i, v := range src {
				dst[(got+i)*ch+c] = float32(v) / d.scale
			}
		}
		d.fpos += n
		got += n
	}
	d.pos += int64(got)
	return got, nil
}

// --- encoding ---

const flacBlock = 4096

type flacEncoder struct {
	f      io.WriteSeeker
	bw     *bufio.Writer
	enc    *flac.Encoder
	format Format
	buf    [][]int32
	n      int
	scale  float64
}

func newFLACEncoder(w io.WriteSeeker, f Format, tags Tags, picture *Picture) (*flacEncoder, error) {
	bits := f.BitDepth
	if bits <= 0 || f.Float {
		bits = 24
	}
	bits = min(max(bits, 16), 24)
	info := &meta.StreamInfo{
		BlockSizeMin: flacBlock, BlockSizeMax: flacBlock,
		SampleRate: uint32(f.SampleRate), NChannels: uint8(f.Channels), BitsPerSample: uint8(bits),
	}
	var blocks []*meta.Block
	var comments [][2]string
	for _, k := range []string{"title", "artist", "album", "date", "genre", "track", "comment"} {
		if v := tags.get(k); v != "" {
			name := strings.ToUpper(k)
			if k == "track" {
				name = "TRACKNUMBER"
			}
			comments = append(comments, [2]string{name, v})
		}
	}
	// The encoder writes block lengths as given, so compute them.
	if len(comments) > 0 {
		const vendor = "Monoform"
		n := 4 + len(vendor) + 4
		for _, c := range comments {
			n += 4 + len(c[0]) + 1 + len(c[1])
		}
		blocks = append(blocks, &meta.Block{Header: meta.Header{Type: meta.TypeVorbisComment, Length: int64(n)}, Body: &meta.VorbisComment{Vendor: vendor, Tags: comments}})
	}
	if picture != nil && len(picture.Data) > 0 && len(picture.Data) < 1<<24-64 {
		n := 32 + len(picture.MIME) + len(picture.Data)
		blocks = append(blocks, &meta.Block{Header: meta.Header{Type: meta.TypePicture, Length: int64(n)}, Body: &meta.Picture{Type: 3, MIME: picture.MIME, Data: picture.Data}})
	}
	bw := bufio.NewWriterSize(w, 256<<10)
	enc, err := flac.NewEncoder(&bufferedSeeker{bw: bw, w: w}, info, blocks...)
	if err != nil {
		return nil, err
	}
	e := &flacEncoder{f: w, bw: bw, enc: enc, format: f, scale: math.Ldexp(1, bits-1)}
	e.format.BitDepth = bits
	e.buf = make([][]int32, f.Channels)
	for i := range e.buf {
		e.buf[i] = make([]int32, flacBlock)
	}
	return e, nil
}

func (e *flacEncoder) Write(samples []float32) error {
	ch := e.format.Channels
	hi := e.scale - 1
	for i := 0; i < len(samples); i += ch {
		for c := 0; c < ch; c++ {
			v := math.Round(float64(samples[i+c]) * e.scale)
			e.buf[c][e.n] = int32(math.Max(-e.scale, math.Min(hi, v)))
		}
		if e.n++; e.n == flacBlock {
			if err := e.flush(); err != nil {
				return err
			}
		}
	}
	return nil
}

func (e *flacEncoder) flush() error {
	if e.n == 0 {
		return nil
	}
	ch := e.format.Channels
	chans := frame.Channels(ch - 1)
	if ch == 2 {
		chans = frame.ChannelsMidSide
	}
	fr := &frame.Frame{
		Header: frame.Header{
			HasFixedBlockSize: true, BlockSize: uint16(e.n), SampleRate: uint32(e.format.SampleRate),
			Channels: chans, BitsPerSample: uint8(e.format.BitDepth),
		},
	}
	for c := 0; c < ch; c++ {
		s := make([]int32, e.n)
		copy(s, e.buf[c][:e.n])
		fr.Subframes = append(fr.Subframes, &frame.Subframe{SubHeader: frame.SubHeader{Pred: frame.PredVerbatim}, Samples: s, NSamples: e.n})
	}
	e.n = 0
	return e.enc.WriteFrame(fr)
}

func (e *flacEncoder) Close() error {
	if err := e.flush(); err != nil {
		return err
	}
	if err := e.enc.Close(); err != nil {
		return err
	}
	return e.bw.Flush() // the rewritten STREAMINFO
}

// bufferedSeeker flushes buffered writes before a seek: the FLAC encoder
// seeks back to rewrite STREAMINFO on Close.
type bufferedSeeker struct {
	bw *bufio.Writer
	w  io.WriteSeeker
}

func (b *bufferedSeeker) Write(p []byte) (int, error) { return b.bw.Write(p) }
func (b *bufferedSeeker) Seek(off int64, whence int) (int64, error) {
	if err := b.bw.Flush(); err != nil {
		return 0, err
	}
	return b.w.Seek(off, whence)
}
