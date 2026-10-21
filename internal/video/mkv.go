package video

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
	"strings"
)

// Matroska element IDs (with their length-marker bits).
const (
	idEBML           = 0x1A45DFA3
	idSegment        = 0x18538067
	idSeekHead       = 0x114D9B74
	idSeek           = 0x4DBB
	idSeekID         = 0x53AB
	idSeekPosition   = 0x53AC
	idInfo           = 0x1549A966
	idTimestampScale = 0x2AD7B1
	idDuration       = 0x4489
	idTitle          = 0x7BA9
	idMuxingApp      = 0x4D80
	idWritingApp     = 0x5741
	idTracks         = 0x1654AE6B
	idTrackEntry     = 0xAE
	idTrackNumber    = 0xD7
	idTrackType      = 0x83
	idCodecID        = 0x86
	idCodecPrivate   = 0x63A2
	idDefaultDur     = 0x23E383
	idVideo          = 0xE0
	idPixelWidth     = 0xB0
	idPixelHeight    = 0xBA
	idAudio          = 0xE1
	idSamplingFreq   = 0xB5
	idChannels       = 0x9F
	idCluster        = 0x1F43B675
	idTimestamp      = 0xE7
	idSimpleBlock    = 0xA3
	idBlockGroup     = 0xA0
	idBlock          = 0xA1
	idReferenceBlock = 0xFB
	idCues           = 0x1C53BB6B
	idCuePoint       = 0xBB
	idCueTime        = 0xB3
	idCueTrackPos    = 0xB7
	idCueTrack       = 0xF7
	idCueClusterPos  = 0xF1
	idTags           = 0x1254C367
	idChapters       = 0x1043A770
	idAttachments    = 0x1941A469
	idVoid           = 0xEC
)

var topLevel = map[uint32]bool{idSeekHead: true, idInfo: true, idTracks: true, idCluster: true, idCues: true, idTags: true, idChapters: true, idAttachments: true}

// reader is a cached ReaderAt for element headers.
type reader struct {
	f    *os.File
	size int64
	buf  []byte
	at   int64
}

func (r *reader) bytes(off int64, n int) []byte {
	if r.f == nil { // in-memory (children of a parsed element)
		if off < 0 || off >= int64(len(r.buf)) {
			return nil
		}
		return r.buf[off:min(int64(len(r.buf)), off+int64(n))]
	}
	if off < r.at || off+int64(n) > r.at+int64(len(r.buf)) {
		r.buf = r.buf[:cap(r.buf)]
		m, _ := r.f.ReadAt(r.buf, off)
		r.buf, r.at = r.buf[:m], off
	}
	lo := int(off - r.at)
	return r.buf[lo:min(len(r.buf), lo+n)]
}

// header reads an element header: id, data size (-1 if unknown) and header length.
func (r *reader) header(off int64) (id uint32, size int64, hl int, err error) {
	b := r.bytes(off, 12)
	if len(b) < 2 {
		return 0, 0, 0, io.EOF
	}
	il := 1
	for il <= 4 && b[0]&(0x80>>(il-1)) == 0 {
		il++
	}
	if il > 4 || len(b) < il+1 {
		return 0, 0, 0, errors.New("bad element id")
	}
	for i := 0; i < il; i++ {
		id = id<<8 | uint32(b[i])
	}
	s := b[il]
	sl := 1
	for sl <= 8 && s&(0x80>>(sl-1)) == 0 {
		sl++
	}
	if sl > 8 || len(b) < il+sl {
		return 0, 0, 0, errors.New("bad element size")
	}
	v := uint64(s & (0xff >> sl))
	allOnes := v == uint64(0xff>>sl)
	for i := 1; i < sl; i++ {
		v = v<<8 | uint64(b[il+i])
		allOnes = allOnes && b[il+i] == 0xff
	}
	if allOnes {
		return id, -1, il + sl, nil
	}
	return id, int64(v), il + sl, nil
}

func (r *reader) data(off int64, n int64) []byte {
	if n > 16<<20 {
		n = 16 << 20
	}
	out := make([]byte, n)
	m, _ := r.f.ReadAt(out, off)
	return out[:m]
}

func uintOf(b []byte) uint64 {
	var v uint64
	for _, x := range b {
		v = v<<8 | uint64(x)
	}
	return v
}

func floatOf(b []byte) float64 {
	switch len(b) {
	case 4:
		return float64(math.Float32frombits(binary.BigEndian.Uint32(b)))
	case 8:
		return math.Float64frombits(binary.BigEndian.Uint64(b))
	}
	return 0
}

// children parses an in-memory master element body into (id, payload) pairs.
func children(b []byte) [][2]any {
	var out [][2]any
	r := &reader{}
	for p := 0; p < len(b); {
		r.buf, r.at = b, 0
		id, size, hl, err := r.header(int64(p))
		if err != nil || size < 0 || p+hl+int(size) > len(b) {
			break
		}
		out = append(out, [2]any{id, b[p+hl : p+hl+int(size)]})
		p += hl + int(size)
	}
	return out
}

type mkvTrack struct {
	number     uint64
	kind       uint64 // 1 video, 2 audio, 17 subtitle
	codec      string
	w, h       int
	rate       float64
	channels   int
	defaultDur uint64
	private    []byte // CodecPrivate
	raw        []byte // whole TrackEntry element
}

type mkvBlock struct {
	track uint64
	time  int64 // timestamp units
	key   bool
	off   int64 // element start
	size  int64 // whole element
	patch int   // offset of the int16 timecode within the element
	end   int64 // end of the (Simple)Block's data (BlockGroups hold more after it)
}

type mkvFile struct {
	r          *reader
	ebml       []byte
	scale      uint64 // ns per timestamp unit
	duration   float64
	title      string
	infoKids   [][2]any
	tracks     []*mkvTrack
	blocks     []mkvBlock
	keepRaw    [][2]int64 // Tags/Attachments to copy (offset, length)
	segDataOff int64
}

func openMKV(path string) (*os.File, *mkvFile, error) {
	fh, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	st, _ := fh.Stat()
	r := &reader{f: fh, size: st.Size(), buf: make([]byte, 0, 64<<10), at: -1}
	m := &mkvFile{r: r, scale: 1000000}
	fail := func(e error) (*os.File, *mkvFile, error) {
		fh.Close()
		return nil, nil, fmt.Errorf("%w: %v", ErrNotEditable, e)
	}
	id, size, hl, err := r.header(0)
	if err != nil || id != idEBML || size < 0 {
		return fail(errors.New("not a Matroska file"))
	}
	m.ebml = r.data(0, int64(hl)+size)
	off := int64(hl) + size
	id, size, hl, err = r.header(off)
	if err != nil || id != idSegment {
		return fail(errors.New("no segment"))
	}
	m.segDataOff = off + int64(hl)
	end := r.size
	if size >= 0 {
		end = min(end, m.segDataOff+size)
	}
	for p := m.segDataOff; p < end; {
		id, size, hl, err := r.header(p)
		if err != nil {
			break
		}
		body := p + int64(hl)
		switch id {
		case idInfo:
			m.infoKids = children(r.data(body, size))
			for _, c := range m.infoKids {
				switch c[0].(uint32) {
				case idTimestampScale:
					m.scale = uintOf(c[1].([]byte))
				case idDuration:
					m.duration = floatOf(c[1].([]byte))
				case idTitle:
					m.title = string(c[1].([]byte))
				}
			}
		case idTracks:
			for _, c := range children(r.data(body, size)) {
				if c[0].(uint32) != idTrackEntry {
					continue
				}
				raw := c[1].([]byte)
				t := &mkvTrack{raw: append(elemHeader(idTrackEntry, len(raw)), raw...)}
				for _, e := range children(raw) {
					v := e[1].([]byte)
					switch e[0].(uint32) {
					case idTrackNumber:
						t.number = uintOf(v)
					case idTrackType:
						t.kind = uintOf(v)
					case idCodecID:
						t.codec = string(v)
					case idCodecPrivate:
						t.private = v
					case idDefaultDur:
						t.defaultDur = uintOf(v)
					case idVideo:
						for _, x := range children(v) {
							switch x[0].(uint32) {
							case idPixelWidth:
								t.w = int(uintOf(x[1].([]byte)))
							case idPixelHeight:
								t.h = int(uintOf(x[1].([]byte)))
							}
						}
					case idAudio:
						for _, x := range children(v) {
							switch x[0].(uint32) {
							case idSamplingFreq:
								t.rate = floatOf(x[1].([]byte))
							case idChannels:
								t.channels = int(uintOf(x[1].([]byte)))
							}
						}
					}
				}
				m.tracks = append(m.tracks, t)
			}
		case idCluster:
			next, err := m.indexCluster(body, size, end)
			if err != nil {
				return fail(err)
			}
			p = next
			continue
		case idTags, idAttachments:
			if size >= 0 {
				m.keepRaw = append(m.keepRaw, [2]int64{p, int64(hl) + size})
			}
		}
		if size < 0 {
			return fail(errors.New("unsupported unknown-size element"))
		}
		p = body + size
	}
	if len(m.tracks) == 0 {
		return fail(errors.New("no tracks"))
	}
	return fh, m, nil
}

// indexCluster records a cluster's blocks and returns where the next
// top-level element starts (clusters from live recorders have unknown size).
func (m *mkvFile) indexCluster(body, size, segEnd int64) (int64, error) {
	r := m.r
	end := segEnd
	if size >= 0 {
		end = min(segEnd, body+size)
	}
	var ts int64
	p := body
	for p < end {
		id, sz, hl, err := r.header(p)
		if err != nil {
			return end, nil
		}
		if size < 0 && topLevel[id] {
			return p, nil
		}
		if sz < 0 {
			return 0, errors.New("unknown-size element inside a cluster")
		}
		data := p + int64(hl)
		switch id {
		case idTimestamp:
			ts = int64(uintOf(r.bytes(data, int(sz))))
		case idSimpleBlock:
			b := r.bytes(data, 8)
			track, vl := vint(b)
			if vl > 0 && len(b) >= vl+3 {
				rel := int16(binary.BigEndian.Uint16(b[vl:]))
				m.blocks = append(m.blocks, mkvBlock{track: track, time: ts + int64(rel), key: b[vl+2]&0x80 != 0, off: p, size: int64(hl) + sz, patch: hl + vl, end: data + sz})
			}
		case idBlockGroup:
			blk := mkvBlock{off: p, size: int64(hl) + sz, key: true}
			for q := data; q < data+sz; {
				cid, csz, chl, err := r.header(q)
				if err != nil || csz < 0 {
					break
				}
				switch cid {
				case idBlock:
					b := r.bytes(q+int64(chl), 8)
					track, vl := vint(b)
					if vl > 0 && len(b) >= vl+2 {
						blk.track = track
						blk.time = ts + int64(int16(binary.BigEndian.Uint16(b[vl:])))
						blk.patch = int(q-p) + chl + vl
						blk.end = q + int64(chl) + csz
					}
				case idReferenceBlock:
					blk.key = false
				}
				q += int64(chl) + csz
			}
			if blk.patch > 0 {
				m.blocks = append(m.blocks, blk)
			}
		}
		p = data + sz
	}
	return end, nil
}

// vint decodes a size-style variable-length integer (marker stripped).
func vint(b []byte) (uint64, int) {
	if len(b) == 0 {
		return 0, 0
	}
	l := 1
	for l <= 8 && b[0]&(0x80>>(l-1)) == 0 {
		l++
	}
	if l > 8 || len(b) < l {
		return 0, 0
	}
	v := uint64(b[0] & (0xff >> l))
	for i := 1; i < l; i++ {
		v = v<<8 | uint64(b[i])
	}
	return v, l
}

func (m *mkvFile) seconds(t int64) float64 { return float64(t) * float64(m.scale) / 1e9 }

func (m *mkvFile) totalDuration() float64 {
	if m.duration > 0 {
		return m.duration * float64(m.scale) / 1e9
	}
	var last int64
	for _, b := range m.blocks {
		last = max(last, b.time)
	}
	return m.seconds(last)
}

func (m *mkvFile) firstOfKind(kind uint64) *mkvTrack {
	for _, t := range m.tracks {
		if t.kind == kind {
			return t
		}
	}
	return nil
}

var mkvCodecs = map[string]string{
	"V_VP8": "VP8", "V_VP9": "VP9", "V_AV1": "AV1", "V_MPEG4/ISO/AVC": "H.264", "V_MPEGH/ISO/HEVC": "HEVC", "V_THEORA": "Theora",
	"A_OPUS": "Opus", "A_VORBIS": "Vorbis", "A_AAC": "AAC", "A_FLAC": "FLAC", "A_MPEG/L3": "MP3", "A_AC3": "AC-3", "A_EAC3": "E-AC-3", "A_PCM/INT/LIT": "PCM",
}

func mkvCodecName(id string) string {
	if n, ok := mkvCodecs[id]; ok {
		return n
	}
	if strings.HasPrefix(id, "A_AAC") {
		return "AAC"
	}
	return strings.TrimPrefix(strings.TrimPrefix(id, "V_"), "A_")
}

func probeMKV(path string) (*Info, error) {
	fh, m, err := openMKV(path)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	info := &Info{Container: "matroska", Duration: m.totalDuration(), Title: m.title}
	if v := m.firstOfKind(1); v != nil {
		info.HasVideo, info.VideoCodec, info.Width, info.Height = true, mkvCodecName(v.codec), v.w, v.h
		n := 0
		for _, b := range m.blocks {
			if b.track == v.number {
				n++
				if b.key {
					info.Keyframes = append(info.Keyframes, max(0, m.seconds(b.time)))
				}
			}
		}
		if v.defaultDur > 0 {
			info.FPS = math.Round(1e9/float64(v.defaultDur)*100) / 100
		} else if info.Duration > 0 {
			info.FPS = math.Round(float64(n)/info.Duration*100) / 100
		}
		sort.Float64s(info.Keyframes)
	}
	if a := m.firstOfKind(2); a != nil {
		info.HasAudio, info.AudioCodec, info.Channels, info.SampleRate = true, mkvCodecName(a.codec), a.channels, int(a.rate)
	}
	if !info.HasVideo && !info.HasAudio {
		return nil, fmt.Errorf("%w: no audio or video track", ErrNotEditable)
	}
	return info, nil
}

// --- writing ---

func encodeID(id uint32) []byte {
	switch {
	case id > 0xFFFFFF:
		return []byte{byte(id >> 24), byte(id >> 16), byte(id >> 8), byte(id)}
	case id > 0xFFFF:
		return []byte{byte(id >> 16), byte(id >> 8), byte(id)}
	case id > 0xFF:
		return []byte{byte(id >> 8), byte(id)}
	}
	return []byte{byte(id)}
}

func encodeSize(n uint64) []byte {
	for l := 1; l <= 8; l++ {
		if n < (uint64(1)<<(7*l))-1 {
			b := make([]byte, l)
			for i := l - 1; i >= 0; i-- {
				b[i] = byte(n)
				n >>= 8
			}
			b[0] |= 0x80 >> (l - 1)
			return b
		}
	}
	panic("size too large")
}

func elemHeader(id uint32, n int) []byte { return append(encodeID(id), encodeSize(uint64(n))...) }

func elem(id uint32, payload []byte) []byte { return append(elemHeader(id, len(payload)), payload...) }

func elemUint(id uint32, v uint64) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, v)
	i := 0
	for i < 7 && b[i] == 0 {
		i++
	}
	return elem(id, b[i:])
}

func elemFloat(id uint32, v float64) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, math.Float64bits(v))
	return elem(id, b)
}

func remuxMKV(ctx context.Context, src string, plan Plan, w io.WriteSeeker, progress func(done, total int64)) ([][2]float64, error) {
	fh, m, err := openMKV(src)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	dur := m.totalDuration()
	keepTrack := map[uint64]bool{}
	var video *mkvTrack
	for _, t := range m.tracks {
		switch {
		case t.kind == 1 && plan.AudioOnly, t.kind == 2 && plan.Mute, t.kind != 2 && plan.AudioOnly:
			continue
		}
		keepTrack[t.number] = true
		if t.kind == 1 && video == nil {
			video = t
		}
	}
	if len(keepTrack) == 0 {
		return nil, errors.New("no track left to write")
	}
	keep := normalize(plan.Keep, dur+1)
	if len(keep) == 0 {
		return nil, errors.New("nothing left to save")
	}
	// Video blocks in file (decode) order decide the ranges.
	type span struct{ a, b int } // indices into vblocks
	var vblocks []int
	if video != nil {
		for i, b := range m.blocks {
			if b.track == video.number {
				vblocks = append(vblocks, i)
			}
		}
	}
	var ranges [][2]int64 // timestamp units
	if len(vblocks) > 0 {
		var spans []span
		for _, k := range keep {
			a, b := 0, len(vblocks)
			for j, bi := range vblocks {
				if m.blocks[bi].key && m.seconds(m.blocks[bi].time) <= k[0]+snapSlack {
					a = j
				}
			}
			for j := a + 1; j < len(vblocks); j++ {
				bl := m.blocks[vblocks[j]]
				if bl.key && m.seconds(bl.time) >= k[1]-snapSlack {
					b = j
					break
				}
			}
			if n := len(spans); n > 0 && a <= spans[n-1].b {
				spans[n-1].b = max(spans[n-1].b, b)
			} else {
				spans = append(spans, span{a, b})
			}
		}
		endTime := int64(math.Ceil(dur * 1e9 / float64(m.scale)))
		for _, s := range spans {
			e := endTime
			if s.b < len(vblocks) {
				e = m.blocks[vblocks[s.b]].time
			}
			ranges = append(ranges, [2]int64{m.blocks[vblocks[s.a]].time, e})
		}
	} else {
		for _, k := range keep {
			ranges = append(ranges, [2]int64{int64(k[0] * 1e9 / float64(m.scale)), int64(math.Ceil(k[1] * 1e9 / float64(m.scale)))})
		}
	}

	// Output.
	bw := bufio.NewWriterSize(w, 1<<20)
	var written int64
	write := func(b []byte) error {
		n, err := bw.Write(b)
		written += int64(n)
		return err
	}
	if err := write(m.ebml); err != nil {
		return nil, err
	}
	segStart := written
	if err := write([]byte{0x18, 0x53, 0x80, 0x67, 0x01, 0, 0, 0, 0, 0, 0, 0}); err != nil { // size patched at the end
		return nil, err
	}
	segData := written
	const seekRoom = 160
	if err := write(append([]byte{idVoid, 0x80 | (seekRoom - 2)}, make([]byte, seekRoom-2)...)); err != nil {
		return nil, err
	}
	var outLen int64
	for _, r := range ranges {
		outLen += r[1] - r[0]
	}
	// Info: keep everything but duration and app names.
	infoPos := written - segData
	var info []byte
	for _, c := range m.infoKids {
		switch c[0].(uint32) {
		case idDuration, idMuxingApp, idWritingApp:
			continue
		}
		info = append(info, elem(c[0].(uint32), c[1].([]byte))...)
	}
	if !hasKid(m.infoKids, idTimestampScale) {
		info = append(info, elemUint(idTimestampScale, m.scale)...)
	}
	info = append(info, elemFloat(idDuration, float64(outLen))...)
	info = append(info, elem(idMuxingApp, []byte("Monoform"))...)
	info = append(info, elem(idWritingApp, []byte("Monoform"))...)
	if err := write(elem(idInfo, info)); err != nil {
		return nil, err
	}
	tracksPos := written - segData
	var tr []byte
	for _, t := range m.tracks {
		if keepTrack[t.number] {
			tr = append(tr, t.raw...)
		}
	}
	if err := write(elem(idTracks, tr)); err != nil {
		return nil, err
	}

	type cue struct {
		time, cluster int64
		track         uint64
	}
	var cues []cue
	var cluster bytes.Buffer
	clusterTs, clusterPos := int64(-1), int64(0)
	flush := func() error {
		if clusterTs < 0 {
			return nil
		}
		body := append(elemUint(idTimestamp, uint64(clusterTs)), cluster.Bytes()...)
		err := write(elem(idCluster, body))
		cluster.Reset()
		clusterTs = -1
		return err
	}
	var total, done int64
	for _, r := range ranges {
		for _, b := range m.blocks {
			if keepTrack[b.track] && b.time >= r[0] && b.time < r[1] {
				total += b.size
			}
		}
	}
	var cursor int64
	buf := make([]byte, 0, 1<<20)
	// Video blocks of a range lie between its starting keyframe and the next
	// range-ending keyframe in file order (open-GOP frames around the cut,
	// which reference frames on the other side, are left out).
	keyAt := func(t int64) int64 {
		for _, bi := range vblocks {
			if m.blocks[bi].key && m.blocks[bi].time == t {
				return m.blocks[bi].off
			}
		}
		return -1
	}
	for _, r := range ranges {
		vFrom, vTo := int64(-1), int64(math.MaxInt64)
		if video != nil {
			vFrom = keyAt(r[0])
			if e := keyAt(r[1]); e >= 0 {
				vTo = e
			}
		}
		for _, b := range m.blocks {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if !keepTrack[b.track] || b.time < r[0] || b.time >= r[1] {
				continue
			}
			if video != nil && b.track == video.number && (b.off < vFrom || b.off >= vTo) {
				continue
			}
			t := b.time - r[0] + cursor
			if clusterTs < 0 || t-clusterTs > 30000 || t-clusterTs < -30000 || cluster.Len() > 8<<20 {
				if err := flush(); err != nil {
					return nil, err
				}
				clusterTs, clusterPos = t, written-segData
			}
			if cap(buf) < int(b.size) {
				buf = make([]byte, b.size)
			}
			raw := buf[:b.size]
			if _, err := fh.ReadAt(raw, b.off); err != nil {
				return nil, fmt.Errorf("reading block: %w", err)
			}
			binary.BigEndian.PutUint16(raw[b.patch:], uint16(int16(t-clusterTs)))
			cluster.Write(raw)
			if b.key && (video != nil && b.track == video.number || video == nil && len(cues) == 0 || video == nil && t-cues[len(cues)-1].time > 5000) {
				cues = append(cues, cue{t, clusterPos, b.track})
			}
			done += b.size
			if progress != nil && done%(4<<20) < b.size {
				progress(done, total)
			}
		}
		cursor += r[1] - r[0]
	}
	if err := flush(); err != nil {
		return nil, err
	}
	cuesPos := written - segData
	var cp []byte
	for _, c := range cues {
		pos := append(elemUint(idCueTrack, c.track), elemUint(idCueClusterPos, uint64(c.cluster))...)
		cp = append(cp, elem(idCuePoint, append(elemUint(idCueTime, uint64(c.time)), elem(idCueTrackPos, pos)...))...)
	}
	if len(cp) > 0 {
		if err := write(elem(idCues, cp)); err != nil {
			return nil, err
		}
	}
	for _, k := range m.keepRaw {
		if err := write(m.r.data(k[0], k[1])); err != nil {
			return nil, err
		}
	}
	if err := bw.Flush(); err != nil {
		return nil, err
	}
	// Segment size and SeekHead.
	if _, err := w.Seek(segStart+4, io.SeekStart); err != nil {
		return nil, err
	}
	sz := make([]byte, 8)
	binary.BigEndian.PutUint64(sz, uint64(written-segData))
	sz[0] = 0x01
	if _, err := w.Write(sz); err != nil {
		return nil, err
	}
	seek := func(id uint32, pos int64) []byte {
		return elem(idSeek, append(elem(idSeekID, encodeID(id)), elemUint(idSeekPosition, uint64(pos))...))
	}
	sh := append(seek(idInfo, infoPos), seek(idTracks, tracksPos)...)
	if len(cp) > 0 {
		sh = append(sh, seek(idCues, cuesPos)...)
	}
	head := elem(idSeekHead, sh)
	if rest := seekRoom - len(head); rest >= 2 {
		head = append(head, append([]byte{idVoid, 0x80 | byte(rest-2)}, make([]byte, rest-2)...)...)
		if _, err := w.Seek(segData, io.SeekStart); err != nil {
			return nil, err
		}
		if _, err := w.Write(head); err != nil {
			return nil, err
		}
	}
	if _, err := w.Seek(0, io.SeekEnd); err != nil {
		return nil, err
	}
	out := make([][2]float64, len(ranges))
	for i, r := range ranges {
		out[i] = [2]float64{m.seconds(r[0]), min(dur, m.seconds(r[1]))}
	}
	return out, nil
}

func hasKid(k [][2]any, id uint32) bool {
	for _, c := range k {
		if c[0].(uint32) == id {
			return true
		}
	}
	return false
}
