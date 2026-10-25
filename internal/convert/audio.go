package convert

import (
	"context"
	"errors"

	"github.com/caffeine-runtime/monoform/internal/audio"
)

// convertAudio decodes the whole file and encodes it as WAV or FLAC, with
// its tags (and, in FLAC, its cover). MP3/OGG come out as 16-bit.
func convertAudio(ctx context.Context, src, dst, to string, progress func(done, total int64)) error {
	info, _, err := audio.Probe(src)
	if err != nil {
		return err
	}
	if !info.Editable {
		return audio.ErrUnsupported
	}
	if info.Frames <= 0 {
		return errors.New("the length of this audio file can't be read")
	}
	segs := []audio.Segment{{Start: 0, End: info.Frames}}
	return audio.Export(ctx, src, segs, dst, audio.ExportOptions{Format: to}, progress)
}
