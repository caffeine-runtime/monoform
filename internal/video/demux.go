package video

// Demux describes a file's elementary streams so the webview can decode
// them with WebCodecs (for rendering effects): codec strings in WebCodecs
// form, decoder configuration and, per sample, where its bytes are. The
// bytes themselves are read through the media server with Range requests.

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"

	"github.com/Eyevinn/mp4ff/mp4"
)

// Stream is one audio or video track.
type Stream struct {
	Kind        string `json:"kind"`  // "video" or "audio"
	Codec       string `json:"codec"` // WebCodecs codec string, "" when unsupported
	Description []byte `json:"description,omitempty"`
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
	SampleRate  int    `json:"sampleRate,omitempty"`
	Channels    int    `json:"channels,omitempty"`
	// Samples in decode order: [pts seconds, duration seconds, byte offset, byte size, key (0/1)].
	Samples [][5]float64 `json:"samples"`
}

// Demux is the decode plan of a file.
type Demux struct {
	Streams []Stream `json:"streams"`
}

// DemuxFile indexes the first video and first audio stream of an MP4/MOV or WebM/MKV file.
func DemuxFile(path string) (*Demux, error) {
	kind, err := sniff(path)
	if err != nil {
		return nil, err
	}
	if kind == "mp4" {
		return demuxMP4(path)
	}
	return demuxMKV(path)
}

// childBox finds a child box of the given type in an encoded sample entry; returns its payload.
func childBox(entry []byte, start int, fourcc string) []byte {
	for p := start; p+8 <= len(entry); p++ {
		if string(entry[p+4:p+8]) != fourcc {
			continue
		}
		n := int(binary.BigEndian.Uint32(entry[p:]))
		if n >= 8 && p+n <= len(entry) {
			return entry[p+8 : p+n]
		}
	}
	return nil
}

func avcCodec(avcC []byte) string {
	if len(avcC) < 4 {
		return ""
	}
	return fmt.Sprintf("avc1.%02x%02x%02x", avcC[1], avcC[2], avcC[3])
}

func av1Codec(av1C []byte) string {
	if len(av1C) < 3 {
		return ""
	}
	profile := av1C[1] >> 5
	level := av1C[1] & 0x1f
	tier := "M"
	if av1C[2]&0x80 != 0 {
		tier = "H"
	}
	depth := 8
	if av1C[2]&0x40 != 0 {
		depth = 10
		if profile == 2 && av1C[2]&0x20 != 0 {
			depth = 12
		}
	}
	return fmt.Sprintf("av01.%d.%02d%s.%02d", profile, level, tier, depth)
}

func vp9Codec(vpcC []byte) string {
	// vpcC is a FullBox: version/flags, then profile, level, bitDepth(4 bits)…
	if len(vpcC) < 7 {
		return "vp09.00.10.08"
	}
	return fmt.Sprintf("vp09.%02d.%02d.%02d", vpcC[4], vpcC[5], vpcC[6]>>4)
}

func demuxMP4(path string) (*Demux, error) {
	fh, _, tracks, err := openMP4(path)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	d := &Demux{}
	have := map[string]bool{}
	for _, t := range tracks {
		kind := map[string]string{"vide": "video", "soun": "audio"}[t.handler]
		stsd := t.trak.Mdia.Minf.Stbl.Stsd
		if kind == "" || have[kind] || stsd == nil || len(stsd.Children) == 0 {
			continue
		}
		have[kind] = true
		box := stsd.Children[0]
		var buf bytes.Buffer
		if err := box.Encode(&buf); err != nil {
			return nil, err
		}
		entry := buf.Bytes()
		s := Stream{Kind: kind}
		switch kind {
		case "video":
			const head = 8 + 78 // box header + VisualSampleEntry fields
			if v, ok := box.(*mp4.VisualSampleEntryBox); ok {
				s.Width, s.Height = int(v.Width), int(v.Height)
			}
			switch box.Type() {
			case "avc1", "avc3":
				s.Description = childBox(entry, head, "avcC")
				s.Codec = avcCodec(s.Description)
			case "vp09":
				s.Codec = vp9Codec(childBox(entry, head, "vpcC"))
			case "vp08":
				s.Codec = "vp8"
			case "av01":
				s.Description = childBox(entry, head, "av1C")
				s.Codec = av1Codec(s.Description)
			}
		case "audio":
			if a, ok := box.(*mp4.AudioSampleEntryBox); ok {
				s.Channels, s.SampleRate = int(a.ChannelCount), int(a.SampleRate)
				switch box.Type() {
				case "mp4a":
					if a.Esds != nil && a.Esds.DecConfigDescriptor.DecSpecificInfo != nil {
						asc := a.Esds.DecConfigDescriptor.DecSpecificInfo.DecConfig
						if a.Esds.DecConfigDescriptor.ObjectType == 0x40 && len(asc) > 0 {
							s.Description = asc
							s.Codec = fmt.Sprintf("mp4a.40.%d", asc[0]>>3)
						}
					}
				case "Opus":
					s.Codec = "opus"
				}
			}
		}
		ts := float64(max(t.timescale, 1))
		s.Samples = make([][5]float64, t.n())
		for i := range s.Samples {
			key := 0.0
			if t.isSync(i) {
				key = 1
			}
			s.Samples[i] = [5]float64{t.pts(i), float64(t.dur[i]) / ts, float64(t.off[i]), float64(t.size[i]), key}
		}
		d.Streams = append(d.Streams, s)
	}
	if len(d.Streams) == 0 {
		return nil, fmt.Errorf("%w: no audio or video track", ErrNotEditable)
	}
	return d, nil
}

// mkvLaces splits a block's payload into frames (no lacing, Xiph, fixed-size or EBML lacing).
// payload starts after the block's flags byte; returns (offset, size) pairs relative to it.
func mkvLaces(flags byte, payload []byte) ([][2]int, error) {
	lacing := (flags >> 1) & 3
	if lacing == 0 {
		return [][2]int{{0, len(payload)}}, nil
	}
	if len(payload) < 1 {
		return nil, errors.New("empty laced block")
	}
	n := int(payload[0]) + 1
	p := 1
	sizes := make([]int, n)
	switch lacing {
	case 1: // Xiph
		for i := 0; i < n-1; i++ {
			for {
				if p >= len(payload) {
					return nil, errors.New("bad Xiph lacing")
				}
				b := int(payload[p])
				p++
				sizes[i] += b
				if b != 255 {
					break
				}
			}
		}
	case 3: // EBML
		v, l := vint(payload[p:])
		if l == 0 {
			return nil, errors.New("bad EBML lacing")
		}
		p += l
		sizes[0] = int(v)
		for i := 1; i < n-1; i++ {
			raw, l := vint(payload[p:])
			if l == 0 {
				return nil, errors.New("bad EBML lacing")
			}
			p += l
			diff := int64(raw) - (int64(1)<<(7*l-1) - 1) // signed: subtract the bias
			sizes[i] = sizes[i-1] + int(diff)
		}
	case 2: // fixed
		each := (len(payload) - p) / n
		for i := range sizes {
			sizes[i] = each
		}
	}
	used := 0
	for i := 0; i < n-1; i++ {
		used += sizes[i]
	}
	if lacing != 2 {
		sizes[n-1] = len(payload) - p - used
	}
	out := make([][2]int, n)
	for i, sz := range sizes {
		if sz < 0 || p+sz > len(payload) {
			return nil, errors.New("lace sizes exceed the block")
		}
		out[i] = [2]int{p, sz}
		p += sz
	}
	return out, nil
}

func demuxMKV(path string) (*Demux, error) {
	fh, m, err := openMKV(path)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	d := &Demux{}
	for _, kind := range []uint64{1, 2} {
		t := m.firstOfKind(kind)
		if t == nil {
			continue
		}
		s := Stream{Kind: map[uint64]string{1: "video", 2: "audio"}[kind], Width: t.w, Height: t.h, SampleRate: int(t.rate), Channels: t.channels}
		private := t.private
		switch t.codec {
		case "V_VP8":
			s.Codec = "vp8"
		case "V_VP9":
			s.Codec = "vp09.00.10.08"
		case "V_AV1":
			s.Description = private
			s.Codec = av1Codec(private)
		case "V_MPEG4/ISO/AVC":
			s.Description = private
			s.Codec = avcCodec(private)
		case "A_OPUS":
			s.Codec, s.Description = "opus", private
		case "A_VORBIS":
			s.Codec, s.Description = "vorbis", private
		case "A_AAC":
			s.Description = private
			if len(private) > 0 {
				s.Codec = fmt.Sprintf("mp4a.40.%d", private[0]>>3)
			}
		}
		var blocks []mkvBlock
		for _, b := range m.blocks {
			if b.track == t.number {
				blocks = append(blocks, b)
			}
		}
		// Durations from the next block's time (Matroska stores none per SimpleBlock).
		times := make([]float64, len(blocks))
		for i, b := range blocks {
			times[i] = m.seconds(b.time)
		}
		sorted := append([]float64(nil), times...)
		sort.Float64s(sorted)
		next := func(at float64) float64 {
			i := sort.SearchFloat64s(sorted, at+1e-9)
			if i < len(sorted) {
				return sorted[i]
			}
			if t.defaultDur > 0 {
				return at + float64(t.defaultDur)/1e9
			}
			return max(at, m.totalDuration())
		}
		for i, b := range blocks {
			head := m.r.bytes(b.off+int64(b.patch), 3)
			if len(head) < 3 {
				continue
			}
			pay := b.off + int64(b.patch) + 3
			payLen := b.end - pay
			key := 0.0
			if b.key {
				key = 1
			}
			laces := [][2]int{{0, int(payLen)}}
			if head[2]&0x06 != 0 {
				if laces, err = mkvLaces(head[2], m.r.data(pay, payLen)); err != nil {
					return nil, err
				}
			}
			dur := next(times[i]) - times[i]
			for j, l := range laces {
				pts := times[i] + dur*float64(j)/float64(len(laces))
				s.Samples = append(s.Samples, [5]float64{pts, dur / float64(len(laces)), float64(pay) + float64(l[0]), float64(l[1]), key})
			}
		}
		d.Streams = append(d.Streams, s)
	}
	if len(d.Streams) == 0 {
		return nil, fmt.Errorf("%w: no audio or video track", ErrNotEditable)
	}
	return d, nil
}
