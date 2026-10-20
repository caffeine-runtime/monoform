package audio

import (
	"errors"
	"os"
	"strconv"
	"strings"

	"github.com/dhowden/tag"
)

// Tags are the common metadata fields: title, artist, album, date, genre, track, comment.
type Tags map[string]string

func (t Tags) get(k string) string {
	if t == nil {
		return ""
	}
	return strings.TrimSpace(t[k])
}

// Picture is embedded cover art.
type Picture struct {
	MIME string
	Data []byte
}

// Info is what the audio module shows about a file.
type Info struct {
	Codec      Codec   `json:"codec"`
	Editable   bool    `json:"editable"`
	Reason     string  `json:"reason,omitempty"` // why not editable
	SampleRate int     `json:"sampleRate"`
	Channels   int     `json:"channels"`
	BitDepth   int     `json:"bitDepth"`
	Float      bool    `json:"float"`
	Frames     int64   `json:"frames"`
	Duration   float64 `json:"duration"`
	Bitrate    int     `json:"bitrate"` // kbit/s, average
	Lossless   bool    `json:"lossless"`
	Tags       Tags    `json:"tags"`
	HasCover   bool    `json:"hasCover"`
}

// Probe reads format, tags and cover presence (it doesn't decode audio,
// except that MP3 length needs a scan of the frame headers).
func Probe(path string) (*Info, *Picture, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	info := &Info{Tags: Tags{}}
	d, codec, err := Open(path)
	if err != nil {
		if !errors.Is(err, ErrUnsupported) {
			return nil, nil, err
		}
		info.Reason = err.Error()
	} else {
		defer d.Close()
		f := d.Format()
		info.Codec, info.Editable = codec, true
		info.SampleRate, info.Channels, info.BitDepth, info.Float, info.Frames = f.SampleRate, f.Channels, f.BitDepth, f.Float, f.Frames
		info.Lossless = codec == WAV || codec == FLAC
		if f.Frames > 0 && f.SampleRate > 0 {
			info.Duration = float64(f.Frames) / float64(f.SampleRate)
			info.Bitrate = int(float64(st.Size()*8) / info.Duration / 1000)
		}
	}
	var pic *Picture
	if codec == WAV {
		if fh, err := os.Open(path); err == nil {
			if w, err := parseWAV(fh); err == nil {
				for k, id := range wavTags {
					if v := w.tags[id]; v != "" {
						info.Tags[k] = v
					}
				}
			}
			fh.Close()
		}
	} else if fh, err := os.Open(path); err == nil {
		if m, err := tag.ReadFrom(fh); err == nil {
			set := func(k, v string) {
				if v = strings.TrimSpace(v); v != "" {
					info.Tags[k] = v
				}
			}
			set("title", m.Title())
			set("artist", m.Artist())
			set("album", m.Album())
			set("genre", m.Genre())
			set("comment", m.Comment())
			if y := m.Year(); y > 0 {
				set("date", strconv.Itoa(y))
			}
			if n, _ := m.Track(); n > 0 {
				set("track", strconv.Itoa(n))
			}
			if p := m.Picture(); p != nil && len(p.Data) > 0 {
				pic = &Picture{MIME: p.MIMEType, Data: p.Data}
				if pic.MIME == "" {
					pic.MIME = "image/jpeg"
				}
				info.HasCover = true
			}
		}
		fh.Close()
	}
	return info, pic, nil
}
