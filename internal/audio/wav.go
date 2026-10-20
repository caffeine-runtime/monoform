package audio

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
)

// --- decoding ---

type wavDecoder struct {
	f          *os.File
	r          *bufio.Reader
	format     Format
	dataOff    int64
	dataLen    int64
	blockAlign int
	pos        int64 // frame
	buf        []byte
}

// wavInfo is what the RIFF chunks say about a WAV file.
type wavInfo struct {
	format     uint16 // 1 PCM, 3 float
	channels   int
	rate       int
	bits       int
	blockAlign int
	dataOff    int64
	dataLen    int64
	tags       map[string]string // LIST/INFO
}

func parseWAV(r io.ReadSeeker) (*wavInfo, error) {
	var hdr [12]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	if string(hdr[:4]) != "RIFF" || string(hdr[8:12]) != "WAVE" {
		return nil, errors.New("not a WAV file")
	}
	info := &wavInfo{tags: map[string]string{}}
	size, _ := r.Seek(0, io.SeekEnd)
	off := int64(12)
	for off+8 <= size {
		var ch [8]byte
		if _, err := r.Seek(off, io.SeekStart); err != nil {
			return nil, err
		}
		if _, err := io.ReadFull(r, ch[:]); err != nil {
			break
		}
		id := string(ch[:4])
		n := int64(binary.LittleEndian.Uint32(ch[4:]))
		body := off + 8
		switch id {
		case "fmt ":
			b := make([]byte, min(n, 64))
			if _, err := io.ReadFull(r, b); err != nil || len(b) < 16 {
				return nil, errors.New("broken fmt chunk")
			}
			info.format = binary.LittleEndian.Uint16(b[0:])
			info.channels = int(binary.LittleEndian.Uint16(b[2:]))
			info.rate = int(binary.LittleEndian.Uint32(b[4:]))
			info.blockAlign = int(binary.LittleEndian.Uint16(b[12:]))
			info.bits = int(binary.LittleEndian.Uint16(b[14:]))
			if info.format == 0xfffe && len(b) >= 26 { // WAVE_FORMAT_EXTENSIBLE: sub-format GUID
				info.format = binary.LittleEndian.Uint16(b[24:])
			}
		case "data":
			info.dataOff = body
			info.dataLen = n
			if n == 0 || n == 0xffffffff || body+n > size { // streamed / truncated writers
				info.dataLen = size - body
			}
		case "LIST":
			b := make([]byte, min(n, 64<<10))
			if _, err := io.ReadFull(r, b); err == nil && len(b) >= 4 && string(b[:4]) == "INFO" {
				for p := 4; p+8 <= len(b); {
					k := string(b[p : p+4])
					l := int(binary.LittleEndian.Uint32(b[p+4:]))
					if p+8+l > len(b) {
						break
					}
					v := b[p+8 : p+8+l]
					for len(v) > 0 && v[len(v)-1] == 0 {
						v = v[:len(v)-1]
					}
					info.tags[k] = string(v)
					p += 8 + l + l&1
				}
			}
		}
		off = body + n + n&1
	}
	if info.channels == 0 || info.rate == 0 || info.dataOff == 0 {
		return nil, errors.New("missing fmt or data chunk")
	}
	if info.format != 1 && info.format != 3 {
		return nil, fmt.Errorf("WAV encoding %#x isn't supported (only PCM and float)", info.format)
	}
	if info.format == 1 && (info.bits < 8 || info.bits > 32 || info.bits%8 != 0) ||
		info.format == 3 && info.bits != 32 && info.bits != 64 {
		return nil, fmt.Errorf("%d-bit samples aren't supported", info.bits)
	}
	if want := info.channels * info.bits / 8; info.blockAlign != want {
		info.blockAlign = want
	}
	return info, nil
}

func newWAVDecoder(f *os.File) (*wavDecoder, error) {
	info, err := parseWAV(f)
	if err != nil {
		return nil, err
	}
	d := &wavDecoder{
		f: f, dataOff: info.dataOff, dataLen: info.dataLen, blockAlign: info.blockAlign,
		format: Format{SampleRate: info.rate, Channels: info.channels, BitDepth: info.bits, Float: info.format == 3,
			Frames: info.dataLen / int64(info.blockAlign)},
	}
	return d, d.SeekFrame(0)
}

func (d *wavDecoder) Format() Format { return d.format }
func (d *wavDecoder) Close() error   { return d.f.Close() }

func (d *wavDecoder) SeekFrame(fr int64) error {
	fr = max(0, min(fr, d.format.Frames))
	if _, err := d.f.Seek(d.dataOff+fr*int64(d.blockAlign), io.SeekStart); err != nil {
		return err
	}
	d.pos = fr
	if d.r == nil {
		d.r = bufio.NewReaderSize(d.f, 256<<10)
	} else {
		d.r.Reset(d.f)
	}
	return nil
}

func (d *wavDecoder) Read(dst []float32) (int, error) {
	ch := d.format.Channels
	frames := min(int64(len(dst)/ch), d.format.Frames-d.pos)
	if frames <= 0 {
		return 0, io.EOF
	}
	need := int(frames) * d.blockAlign
	if cap(d.buf) < need {
		d.buf = make([]byte, need)
	}
	b := d.buf[:need]
	n, err := io.ReadFull(d.r, b)
	frames = int64(n / d.blockAlign)
	bytesPer := d.format.BitDepth / 8
	for i := 0; i < int(frames)*ch; i++ {
		p := b[i*bytesPer:]
		var v float32
		switch {
		case d.format.Float && bytesPer == 4:
			v = math.Float32frombits(binary.LittleEndian.Uint32(p))
		case d.format.Float:
			v = float32(math.Float64frombits(binary.LittleEndian.Uint64(p)))
		case bytesPer == 1:
			v = (float32(p[0]) - 128) / 128
		case bytesPer == 2:
			v = float32(int16(binary.LittleEndian.Uint16(p))) / 32768
		case bytesPer == 3:
			v = float32(int32(uint32(p[0])<<8|uint32(p[1])<<16|uint32(p[2])<<24)>>8) / 8388608
		default:
			v = float32(float64(int32(binary.LittleEndian.Uint32(p))) / 2147483648)
		}
		dst[i] = v
	}
	d.pos += frames
	if frames == 0 && err != nil {
		return 0, io.EOF
	}
	return int(frames), nil
}

// --- encoding ---

// wavEncoder writes PCM (8/16/24/32-bit) or 32-bit float WAV to a seekable file.
type wavEncoder struct {
	w        io.WriteSeeker
	bw       *bufio.Writer
	format   Format
	dataOff  int64
	dataSize int64
	buf      []byte
	ditherSt uint32
}

// wavTags maps our tag names to RIFF INFO ids.
var wavTags = map[string]string{"title": "INAM", "artist": "IART", "album": "IPRD", "date": "ICRD", "genre": "IGNR", "track": "ITRK", "comment": "ICMT"}

func newWAVEncoder(w io.WriteSeeker, f Format, tags Tags) (*wavEncoder, error) {
	e := &wavEncoder{w: w, bw: bufio.NewWriterSize(w, 256<<10), format: f, ditherSt: 0x9e3779b9}
	bits := f.BitDepth
	formatTag := uint16(1)
	if f.Float {
		bits, formatTag = 32, 3
	}
	block := f.Channels * bits / 8
	var info []byte
	for _, k := range []string{"title", "artist", "album", "date", "genre", "track", "comment"} {
		v := tags.get(k)
		if v == "" {
			continue
		}
		b := append([]byte(v), 0)
		info = append(info, wavTags[k]...)
		info = binary.LittleEndian.AppendUint32(info, uint32(len(b)))
		info = append(info, b...)
		if len(b)&1 == 1 {
			info = append(info, 0)
		}
	}
	h := []byte("RIFF\x00\x00\x00\x00WAVEfmt ")
	h = binary.LittleEndian.AppendUint32(h, 16)
	h = binary.LittleEndian.AppendUint16(h, formatTag)
	h = binary.LittleEndian.AppendUint16(h, uint16(f.Channels))
	h = binary.LittleEndian.AppendUint32(h, uint32(f.SampleRate))
	h = binary.LittleEndian.AppendUint32(h, uint32(f.SampleRate*block))
	h = binary.LittleEndian.AppendUint16(h, uint16(block))
	h = binary.LittleEndian.AppendUint16(h, uint16(bits))
	if len(info) > 0 {
		h = append(h, "LIST"...)
		h = binary.LittleEndian.AppendUint32(h, uint32(len(info)+4))
		h = append(h, "INFO"...)
		h = append(h, info...)
	}
	h = append(h, "data\x00\x00\x00\x00"...)
	if _, err := e.bw.Write(h); err != nil {
		return nil, err
	}
	e.dataOff = int64(len(h))
	e.format.BitDepth = bits
	return e, nil
}

// onGrid adds dither to a scaled sample unless it is already an integer, so
// untouched samples of a 16-bit source stay bit-exact.
func (e *wavEncoder) onGrid(v float32) float32 {
	if v == float32(math.Round(float64(v))) {
		return v
	}
	return v + e.dither()
}

// dither returns triangular noise of ±1 LSB at 16 bits and below.
func (e *wavEncoder) dither() float32 {
	next := func() float32 {
		e.ditherSt ^= e.ditherSt << 13
		e.ditherSt ^= e.ditherSt >> 17
		e.ditherSt ^= e.ditherSt << 5
		return float32(e.ditherSt)/4294967296 - 0.5
	}
	return next() + next()
}

func (e *wavEncoder) Write(samples []float32) error {
	bytesPer := e.format.BitDepth / 8
	need := len(samples) * bytesPer
	if cap(e.buf) < need {
		e.buf = make([]byte, need)
	}
	b := e.buf[:need]
	for i, s := range samples {
		s = clamp(s)
		p := b[i*bytesPer:]
		switch {
		case e.format.Float:
			binary.LittleEndian.PutUint32(p, math.Float32bits(s))
		case bytesPer == 1:
			p[0] = uint8(clampInt(int64(math.Round(float64(e.onGrid(s*128)+128))), 0, 255))
		case bytesPer == 2:
			binary.LittleEndian.PutUint16(p, uint16(int16(clampInt(int64(math.Round(float64(e.onGrid(s*32768)))), -32768, 32767))))
		case bytesPer == 3:
			v := int32(clampInt(int64(math.Round(float64(s)*8388608)), -8388608, 8388607))
			p[0], p[1], p[2] = byte(v), byte(v>>8), byte(v>>16)
		default:
			binary.LittleEndian.PutUint32(p, uint32(int32(clampInt(int64(math.Round(float64(s)*2147483648)), math.MinInt32, math.MaxInt32))))
		}
	}
	e.dataSize += int64(need)
	if e.dataOff+e.dataSize > math.MaxUint32 {
		return errors.New("the result is larger than 4 GB, the WAV limit — export as FLAC instead")
	}
	_, err := e.bw.Write(b)
	return err
}

func (e *wavEncoder) Close() error {
	if e.dataSize&1 == 1 {
		e.bw.WriteByte(0)
	}
	if err := e.bw.Flush(); err != nil {
		return err
	}
	patch := func(off int64, v uint32) error {
		if _, err := e.w.Seek(off, io.SeekStart); err != nil {
			return err
		}
		return binary.Write(e.w, binary.LittleEndian, v)
	}
	if err := patch(4, uint32(e.dataOff+e.dataSize+e.dataSize&1-8)); err != nil {
		return err
	}
	return patch(e.dataOff-4, uint32(e.dataSize))
}

func clampInt(v, lo, hi int64) int64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
