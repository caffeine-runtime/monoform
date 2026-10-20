package audio

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"

	mp3 "github.com/hajimehoshi/go-mp3"
)

// --- frame index (also used for lossless cuts) ---

type mp3Frame struct {
	off  int64
	size int32
}

type mp3Index struct {
	id3v2     []byte // leading ID3v2 tag, copied as-is into cut files
	id3v1     []byte // trailing 128-byte ID3v1 tag
	frames    []mp3Frame
	rate      int
	channels  int
	spf       int // samples per frame: 1152 (MPEG-1) or 576 (MPEG-2/2.5)
	infoFrame int // index of a Xing/Info/VBRI header frame, or -1
	bitrate   int // kbit/s of the first audio frame
}

var mp3Bitrates = [2][16]int{
	{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0}, // MPEG-1 layer III
	{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},     // MPEG-2/2.5 layer III
}
var mp3Rates = [3][3]int{{44100, 48000, 32000}, {22050, 24000, 16000}, {11025, 12000, 8000}}

type mp3Header struct {
	mpeg1    bool
	rate     int
	bitrate  int
	size     int
	channels int
	spf      int
	sideInfo int
}

// parseMP3Header decodes a layer III frame header.
func parseMP3Header(h []byte) (mp3Header, bool) {
	if len(h) < 4 || h[0] != 0xff || h[1]&0xe0 != 0xe0 {
		return mp3Header{}, false
	}
	ver := (h[1] >> 3) & 3 // 0: 2.5, 2: 2, 3: 1
	layer := (h[1] >> 1) & 3
	bi := h[2] >> 4
	ri := (h[2] >> 2) & 3
	if ver == 1 || layer != 1 || bi == 0 || bi == 15 || ri == 3 {
		return mp3Header{}, false
	}
	var x mp3Header
	x.mpeg1 = ver == 3
	vi, bt := 0, 0
	switch ver {
	case 2:
		vi, bt = 1, 1
	case 0:
		vi, bt = 2, 1
	}
	x.rate = mp3Rates[vi][ri]
	x.bitrate = mp3Bitrates[bt][bi]
	pad := int(h[2]>>1) & 1
	mono := h[3]>>6 == 3
	x.channels = 2
	if mono {
		x.channels = 1
	}
	if x.mpeg1 {
		x.spf = 1152
		x.size = 144*x.bitrate*1000/x.rate + pad
		x.sideInfo = 32
		if mono {
			x.sideInfo = 17
		}
	} else {
		x.spf = 576
		x.size = 72*x.bitrate*1000/x.rate + pad
		x.sideInfo = 17
		if mono {
			x.sideInfo = 9
		}
	}
	return x, true
}

func indexMP3(f *os.File) (*mp3Index, error) {
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := st.Size()
	idx := &mp3Index{infoFrame: -1}
	var off int64
	head := make([]byte, 10)
	if _, err := f.ReadAt(head, 0); err == nil && string(head[:3]) == "ID3" {
		n := int64(head[6]&0x7f)<<21 | int64(head[7]&0x7f)<<14 | int64(head[8]&0x7f)<<7 | int64(head[9]&0x7f)
		off = 10 + n
		if head[5]&0x10 != 0 {
			off += 10 // footer
		}
		idx.id3v2 = make([]byte, off)
		if _, err := f.ReadAt(idx.id3v2, 0); err != nil {
			return nil, err
		}
	}
	end := size
	tail := make([]byte, 128)
	if size >= 128 {
		if _, err := f.ReadAt(tail, size-128); err == nil && string(tail[:3]) == "TAG" {
			idx.id3v1 = tail
			end = size - 128
		}
	}
	r := bufio.NewReaderSize(io.NewSectionReader(f, off, end-off), 64<<10)
	pos := off
	var first mp3Header
	skipped := 0
	next := make([]byte, 4)
	for pos+4 <= end {
		peek, _ := r.Peek(int(min(48, end-pos)))
		if len(peek) < 4 {
			break
		}
		x, ok := parseMP3Header(peek)
		if ok && len(idx.frames) > 0 && (x.rate != first.rate || x.mpeg1 != first.mpeg1) {
			ok = false
		}
		if ok && pos+int64(x.size) > end {
			break // truncated last frame
		}
		if ok && len(idx.frames) == 0 && pos+int64(x.size)+4 <= end {
			// Guard against a false sync: the next frame must follow.
			f.ReadAt(next, pos+int64(x.size))
			if y, ok2 := parseMP3Header(next); !ok2 || y.rate != x.rate {
				ok = false
			}
		}
		if !ok {
			// Junk between frames (or an APE tag): slide one byte.
			if skipped++; skipped > 1<<20 {
				break
			}
			if _, err := r.Discard(1); err != nil {
				break
			}
			pos++
			continue
		}
		if len(idx.frames) == 0 {
			first = x
			idx.rate, idx.channels, idx.spf, idx.bitrate = x.rate, x.channels, x.spf, x.bitrate
			// A Xing/Info/VBRI frame carries no audio.
			if t := 4 + x.sideInfo; len(peek) >= t+4 {
				if tag := string(peek[t : t+4]); tag == "Xing" || tag == "Info" {
					idx.infoFrame = 0
				}
			}
			if len(peek) >= 40 && string(peek[36:40]) == "VBRI" {
				idx.infoFrame = 0
			}
		}
		idx.frames = append(idx.frames, mp3Frame{pos, int32(x.size)})
		if _, err := r.Discard(x.size); err != nil {
			break
		}
		pos += int64(x.size)
	}
	if len(idx.frames) == 0 {
		return nil, errors.New("no MP3 frames found")
	}
	return idx, nil
}

// --- decoding ---

type mp3Decoder struct {
	f      *os.File
	d      *mp3.Decoder
	idx    *mp3Index
	format Format
	buf    []byte
	pos    int64
}

func newMP3Decoder(f *os.File) (*mp3Decoder, error) {
	idx, err := indexMP3(f)
	if err != nil {
		return nil, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	d, err := mp3.NewDecoder(f)
	if err != nil {
		return nil, err
	}
	return &mp3Decoder{f: f, d: d, idx: idx, format: Format{
		SampleRate: d.SampleRate(), Channels: idx.channels, Frames: d.Length() / 4,
	}}, nil
}

func (d *mp3Decoder) Format() Format { return d.format }
func (d *mp3Decoder) Close() error   { return d.f.Close() }

// mp3Preroll is how many frames before a seek target are decoded and
// dropped: a frame depends on earlier ones (bit reservoir up to 511 bytes
// back, MDCT overlap, synthesis filter memory), so decoding can't start
// exactly at the target.
const mp3Preroll = 10

func (d *mp3Decoder) SeekFrame(fr int64) error {
	fr = max(0, min(fr, d.format.Frames))
	start := max(0, fr-int64(mp3Preroll*d.idx.spf))
	if _, err := d.d.Seek(start*4, io.SeekStart); err != nil {
		return err
	}
	if skip := (fr - start) * 4; skip > 0 {
		if _, err := io.CopyN(io.Discard, d.d, skip); err != nil && !errors.Is(err, io.EOF) {
			return err
		}
	}
	d.pos = fr
	return nil
}

// Read converts go-mp3's 16-bit stereo output (mono files come duplicated).
func (d *mp3Decoder) Read(dst []float32) (int, error) {
	ch := d.format.Channels
	frames := len(dst) / ch
	need := frames * 4
	if cap(d.buf) < need {
		d.buf = make([]byte, need)
	}
	n, err := io.ReadFull(d.d, d.buf[:need])
	got := n / 4
	for i := 0; i < got; i++ {
		l := float32(int16(binary.LittleEndian.Uint16(d.buf[i*4:]))) / 32768
		if ch == 1 {
			dst[i] = l
			continue
		}
		dst[i*2] = l
		dst[i*2+1] = float32(int16(binary.LittleEndian.Uint16(d.buf[i*4+2:]))) / 32768
	}
	d.pos += int64(got)
	if got == 0 && err != nil {
		return 0, io.EOF
	}
	return got, nil
}

// --- lossless cut ---

// cutMP3 writes the given sample ranges of an MP3 file by copying whole
// frames: no re-encoding, so no quality loss. Range edges snap to frame
// boundaries (1152 samples at most ≈ 26 ms). The Xing/Info frame is dropped
// because its length and seek table would be wrong; the ID3 tags are kept.
func cutMP3(src string, ranges [][2]int64, w io.Writer, progress func(done, total int64)) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	idx, err := indexMP3(f)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(w, 256<<10)
	if _, err := bw.Write(idx.id3v2); err != nil {
		return err
	}
	// go-mp3 decodes the info frame as silence, so frame i covers samples [i*spf, (i+1)*spf).
	var total, done int64
	type span struct{ a, b int }
	var spans []span
	for _, r := range ranges {
		a := int((r[0] + int64(idx.spf)/2) / int64(idx.spf))
		b := int((r[1] + int64(idx.spf)/2) / int64(idx.spf))
		a, b = max(a, 0), min(b, len(idx.frames))
		if b > a {
			spans = append(spans, span{a, b})
			total += int64(b - a)
		}
	}
	if total == 0 {
		return errors.New("nothing left to save")
	}
	buf := make([]byte, 2048)
	for _, s := range spans {
		for i := s.a; i < s.b; i++ {
			done++
			if i == idx.infoFrame {
				continue
			}
			fr := idx.frames[i]
			if cap(buf) < int(fr.size) {
				buf = make([]byte, fr.size)
			}
			if _, err := f.ReadAt(buf[:fr.size], fr.off); err != nil {
				return fmt.Errorf("reading frame %d: %w", i, err)
			}
			if _, err := bw.Write(buf[:fr.size]); err != nil {
				return err
			}
			if progress != nil && done%2048 == 0 {
				progress(done, total)
			}
		}
	}
	if _, err := bw.Write(idx.id3v1); err != nil {
		return err
	}
	return bw.Flush()
}
