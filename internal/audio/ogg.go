package audio

import (
	"bufio"
	"io"
	"os"

	"github.com/jfreymuth/oggvorbis"
)

type vorbisDecoder struct {
	f      *os.File
	r      *oggvorbis.Reader
	format Format
}

// bufSeeker gives the Vorbis reader buffered reads that still seek.
type bufSeeker struct {
	f  *os.File
	br *bufio.Reader
}

func (b *bufSeeker) Read(p []byte) (int, error) { return b.br.Read(p) }
func (b *bufSeeker) Seek(off int64, whence int) (int64, error) {
	if whence == io.SeekCurrent {
		cur, err := b.f.Seek(0, io.SeekCurrent)
		if err != nil {
			return 0, err
		}
		off, whence = cur-int64(b.br.Buffered())+off, io.SeekStart
	}
	n, err := b.f.Seek(off, whence)
	b.br.Reset(b.f)
	return n, err
}

func newVorbisDecoder(f *os.File) (*vorbisDecoder, error) {
	r, err := oggvorbis.NewReader(&bufSeeker{f: f, br: bufio.NewReaderSize(f, 64<<10)})
	if err != nil {
		return nil, err
	}
	frames := r.Length()
	if frames <= 0 {
		frames = -1
	}
	return &vorbisDecoder{f: f, r: r, format: Format{SampleRate: r.SampleRate(), Channels: r.Channels(), Frames: frames}}, nil
}

func (d *vorbisDecoder) Format() Format { return d.format }
func (d *vorbisDecoder) Close() error   { return d.f.Close() }

func (d *vorbisDecoder) SeekFrame(fr int64) error {
	if d.format.Frames >= 0 {
		fr = min(fr, d.format.Frames)
	}
	return d.r.SetPosition(max(fr, 0))
}

func (d *vorbisDecoder) Read(dst []float32) (int, error) {
	n, err := d.r.Read(dst)
	frames := n / d.format.Channels
	if frames == 0 && err != nil {
		return 0, io.EOF
	}
	return frames, nil
}
