// Package audio decodes, analyses, edits and encodes audio files in pure Go:
// WAV, MP3, FLAC and Ogg Vorbis in; WAV and FLAC out (plus lossless frame-level
// cuts of MP3 files). Everything streams, so file length doesn't change
// memory use.
package audio

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// Format describes a decoded stream.
type Format struct {
	SampleRate int
	Channels   int
	// BitDepth of the source samples (0 for lossy codecs); Float for IEEE float WAV.
	BitDepth int
	Float    bool
	// Frames is the length in sample frames (-1 if unknown).
	Frames int64
}

// Decoder yields interleaved float32 samples in [-1, 1].
type Decoder interface {
	Format() Format
	// Read fills dst (a multiple of Channels) and returns the number of frames.
	Read(dst []float32) (int, error)
	// SeekFrame positions the next Read at frame f.
	SeekFrame(f int64) error
	Close() error
}

// Codec identifies a container/codec combination we can decode.
type Codec string

const (
	WAV    Codec = "wav"
	MP3    Codec = "mp3"
	FLAC   Codec = "flac"
	Vorbis Codec = "vorbis"
)

// ErrUnsupported is returned for files the pure-Go decoders can't read.
var ErrUnsupported = errors.New("this audio format can be played but not edited")

// Sniff identifies the codec from the first bytes of a file.
func Sniff(head []byte) (Codec, error) {
	switch {
	case len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WAVE":
		return WAV, nil
	case len(head) >= 4 && string(head[:4]) == "fLaC":
		return FLAC, nil
	case len(head) >= 4 && string(head[:4]) == "OggS":
		if bytes.Contains(head[:min(len(head), 128)], []byte("\x01vorbis")) {
			return Vorbis, nil
		}
		if bytes.Contains(head[:min(len(head), 128)], []byte("OpusHead")) {
			return "", fmt.Errorf("Opus: %w", ErrUnsupported)
		}
		if bytes.Contains(head[:min(len(head), 128)], []byte("\x7fFLAC")) {
			return "", fmt.Errorf("FLAC in Ogg: %w", ErrUnsupported)
		}
	case len(head) >= 3 && string(head[:3]) == "ID3":
		// An ID3v2 tag usually fronts MP3, but AAC/FLAC can carry one too:
		// look at what follows the tag.
		if len(head) >= 10 {
			size := int(head[6]&0x7f)<<21 | int(head[7]&0x7f)<<14 | int(head[8]&0x7f)<<7 | int(head[9]&0x7f)
			if 10+size+4 <= len(head) {
				return Sniff(head[10+size:])
			}
		}
		return MP3, nil
	case len(head) >= 2 && head[0] == 0xff && head[1]&0xe6 == 0xe2: // MPEG audio layer III sync
		return MP3, nil
	case len(head) >= 8 && string(head[4:8]) == "ftyp":
		return "", fmt.Errorf("MP4/AAC: %w", ErrUnsupported)
	}
	return "", ErrUnsupported
}

// sniffFile reads enough of a file to identify it (an ID3 tag can be large).
func sniffFile(f *os.File) (Codec, error) {
	head := make([]byte, 64<<10)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return "", err
	}
	head = head[:n]
	if len(head) >= 10 && string(head[:3]) == "ID3" {
		size := int(head[6]&0x7f)<<21 | int(head[7]&0x7f)<<14 | int(head[8]&0x7f)<<7 | int(head[9]&0x7f)
		if 10+size+16 > len(head) {
			// The tag is bigger than what we read: look right after it.
			after := make([]byte, 16)
			if _, err := f.ReadAt(after, int64(10+size)); err == nil {
				return Sniff(after)
			}
		}
	}
	return Sniff(head)
}

// Open returns a decoder for the file.
func Open(path string) (Decoder, Codec, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	codec, err := sniffFile(f)
	if err == nil {
		_, err = f.Seek(0, io.SeekStart)
	}
	if err != nil {
		f.Close()
		return nil, "", err
	}
	var d Decoder
	switch codec {
	case WAV:
		d, err = newWAVDecoder(f)
	case MP3:
		d, err = newMP3Decoder(f)
	case FLAC:
		d, err = newFLACDecoder(f)
	case Vorbis:
		d, err = newVorbisDecoder(f)
	}
	if err != nil {
		f.Close()
		return nil, "", fmt.Errorf("%s: %w", strings.ToUpper(string(codec)), err)
	}
	return d, codec, nil
}

// readFull reads until dst is full (in frames) or the stream ends.
func readFull(d Decoder, dst []float32) (int, error) {
	ch := d.Format().Channels
	total := 0
	for total*ch < len(dst) {
		n, err := d.Read(dst[total*ch:])
		total += n
		if err != nil {
			if errors.Is(err, io.EOF) {
				return total, io.EOF
			}
			return total, err
		}
		if n == 0 {
			return total, io.EOF
		}
	}
	return total, nil
}

func clamp(v float32) float32 {
	if v > 1 {
		return 1
	}
	if v < -1 {
		return -1
	}
	return v
}
