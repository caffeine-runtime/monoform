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

	"github.com/Eyevinn/mp4ff/mp4"
)

// mp4Track holds one track's sample table, flattened.
type mp4Track struct {
	trak      *mp4.TrakBox
	handler   string // "vide", "soun", ...
	timescale uint32
	dts       []uint64
	dur       []uint32
	cto       []int32
	size      []uint32
	off       []uint64
	sync      []bool // nil: every sample is a sync sample
	mediaTime int64  // first edit-list media time (presentation starts there)
}

func (t *mp4Track) n() int { return len(t.size) }

// pts is a sample's presentation time in seconds.
func (t *mp4Track) pts(i int) float64 {
	c := int64(0)
	if t.cto != nil {
		c = int64(t.cto[i])
	}
	return float64(int64(t.dts[i])+c-t.mediaTime) / float64(t.timescale)
}

func (t *mp4Track) isSync(i int) bool { return t.sync == nil || t.sync[i] }

func (t *mp4Track) end() uint64 {
	if t.n() == 0 {
		return 0
	}
	return t.dts[t.n()-1] + uint64(t.dur[t.n()-1])
}

func codecName(fourcc string) string {
	switch strings.TrimSpace(fourcc) {
	case "avc1", "avc3":
		return "H.264"
	case "hvc1", "hev1", "dvh1", "dvhe":
		return "HEVC"
	case "vp08":
		return "VP8"
	case "vp09":
		return "VP9"
	case "av01":
		return "AV1"
	case "mp4v":
		return "MPEG-4"
	case "mp4a":
		return "AAC"
	case "Opus":
		return "Opus"
	case "ac-3":
		return "AC-3"
	case "ec-3":
		return "E-AC-3"
	case "fLaC":
		return "FLAC"
	case "mp3", ".mp3":
		return "MP3"
	}
	return fourcc
}

func openMP4(path string) (*os.File, *mp4.File, []*mp4Track, error) {
	fh, err := os.Open(path)
	if err != nil {
		return nil, nil, nil, err
	}
	f, err := mp4.DecodeFile(fh, mp4.WithDecodeMode(mp4.DecModeLazyMdat))
	if err != nil {
		fh.Close()
		return nil, nil, nil, fmt.Errorf("%w: %v", ErrNotEditable, err)
	}
	if f.Moov == nil {
		fh.Close()
		return nil, nil, nil, fmt.Errorf("%w: no movie header", ErrNotEditable)
	}
	var tracks []*mp4Track
	for _, trak := range f.Moov.Traks {
		t, err := loadTrack(trak)
		if err != nil {
			fh.Close()
			return nil, nil, nil, fmt.Errorf("%w: %v", ErrNotEditable, err)
		}
		tracks = append(tracks, t)
	}
	if f.IsFragmented() || f.Moov.Mvex != nil {
		if err := loadFragments(f, tracks); err != nil {
			fh.Close()
			return nil, nil, nil, fmt.Errorf("%w: %v", ErrNotEditable, err)
		}
	}
	return fh, f, tracks, nil
}

// loadFragments appends the samples of a fragmented file's moofs to its
// tracks (screen recordings are fragmented MP4). Each fragment's decode
// time (tfdt) is trusted over the sample durations before it: a recorder
// only guesses the last sample's duration, so durations are taken from the
// next sample's decode time and a fragment that starts earlier than the
// guess doesn't overlap anything.
func loadFragments(f *mp4.File, tracks []*mp4Track) error {
	byID := map[uint32]*mp4Track{}
	trex := map[uint32]*mp4.TrexBox{}
	for _, t := range tracks {
		byID[t.trak.Tkhd.TrackID] = t
	}
	if f.Moov.Mvex != nil {
		for _, x := range f.Moov.Mvex.Trexs {
			trex[x.TrackID] = x
		}
	}
	for _, seg := range f.Segments {
		for _, frag := range seg.Fragments {
			moof := frag.Moof
			if moof == nil {
				continue
			}
			for ti, traf := range moof.Trafs {
				tfhd := traf.Tfhd
				t := byID[tfhd.TrackID]
				if t == nil {
					continue
				}
				if traf.Senc != nil || traf.UUIDSenc != nil || traf.Saiz != nil {
					return errors.New("encrypted video")
				}
				next := t.end()
				if traf.Tfdt != nil {
					next = traf.Tfdt.BaseMediaDecodeTime()
				}
				if n := t.n(); n > 0 && next > t.dts[n-1] && next-t.dts[n-1] <= math.MaxUint32 {
					t.dur[n-1] = uint32(next - t.dts[n-1])
				}
				base := moof.StartPos
				switch {
				case tfhd.HasBaseDataOffset():
					base = tfhd.BaseDataOffset
				case !tfhd.DefaultBaseIfMoof() && ti > 0:
					return errors.New("unsupported fragment layout")
				}
				off := base
				for _, trun := range traf.Truns {
					trun.AddSampleDefaultValues(tfhd, trex[tfhd.TrackID])
					if trun.HasDataOffset() {
						off = uint64(int64(base) + int64(trun.DataOffset))
					}
					for _, s := range trun.Samples {
						if n := t.n(); n > 0 && next < t.dts[n-1] {
							return errors.New("fragments go back in time")
						}
						t.dts = append(t.dts, next)
						t.dur = append(t.dur, s.Dur)
						t.size = append(t.size, s.Size)
						t.off = append(t.off, off)
						if s.CompositionTimeOffset != 0 && t.cto == nil {
							t.cto = make([]int32, t.n()-1, t.n())
						}
						if t.cto != nil {
							t.cto = append(t.cto, s.CompositionTimeOffset)
						}
						sync := mp4.IsSyncSampleFlags(s.Flags)
						if !sync && t.sync == nil {
							t.sync = make([]bool, t.n()-1, t.n())
							for i := range t.sync {
								t.sync[i] = true
							}
						}
						if t.sync != nil {
							t.sync = append(t.sync, sync)
						}
						off += uint64(s.Size)
						next += uint64(s.Dur)
					}
				}
			}
		}
	}
	for _, t := range tracks {
		if t.handler == "vide" && t.n() > 0 && !t.isSync(0) {
			return errors.New("the video doesn't start with a keyframe")
		}
	}
	return nil
}

func loadTrack(trak *mp4.TrakBox) (*mp4Track, error) {
	if trak.Mdia == nil || trak.Mdia.Minf == nil || trak.Mdia.Minf.Stbl == nil || trak.Mdia.Mdhd == nil {
		return nil, errors.New("incomplete track")
	}
	stbl := trak.Mdia.Minf.Stbl
	t := &mp4Track{trak: trak, timescale: trak.Mdia.Mdhd.Timescale}
	if trak.Mdia.Hdlr != nil {
		t.handler = trak.Mdia.Hdlr.HandlerType
	}
	if stbl.Stsz == nil || stbl.Stts == nil || stbl.Stsc == nil || (stbl.Stco == nil && stbl.Co64 == nil) {
		return nil, errors.New("unsupported sample table")
	}
	n := int(stbl.Stsz.SampleNumber)
	t.size = make([]uint32, n)
	for i := range t.size {
		if stbl.Stsz.SampleUniformSize != 0 {
			t.size[i] = stbl.Stsz.SampleUniformSize
		} else {
			t.size[i] = stbl.Stsz.SampleSize[i]
		}
	}
	// Decode times.
	t.dts = make([]uint64, n)
	t.dur = make([]uint32, n)
	i := 0
	var acc uint64
	for e, cnt := range stbl.Stts.SampleCount {
		for k := uint32(0); k < cnt && i < n; k++ {
			t.dts[i], t.dur[i] = acc, stbl.Stts.SampleTimeDelta[e]
			acc += uint64(stbl.Stts.SampleTimeDelta[e])
			i++
		}
	}
	if i != n {
		return nil, errors.New("sample times don't match the sample count")
	}
	if stbl.Ctts != nil {
		cto, err := stbl.Ctts.CompositionTimeOffsets(uint32(n))
		if err != nil {
			return nil, err
		}
		t.cto = cto
	}
	if stbl.Stss != nil {
		t.sync = make([]bool, n)
		for _, s := range stbl.Stss.SampleNumber {
			if s >= 1 && int(s) <= n {
				t.sync[s-1] = true
			}
		}
	}
	// Byte offsets: walk the chunks.
	var chunkOffsets []uint64
	if stbl.Co64 != nil {
		chunkOffsets = stbl.Co64.ChunkOffset
	} else {
		for _, o := range stbl.Stco.ChunkOffset {
			chunkOffsets = append(chunkOffsets, uint64(o))
		}
	}
	t.off = make([]uint64, n)
	s := 0
	entries := stbl.Stsc.Entries
	for c := range chunkOffsets {
		chunk := uint32(c + 1)
		per := uint32(0)
		for e := len(entries) - 1; e >= 0; e-- {
			if entries[e].FirstChunk <= chunk {
				per = entries[e].SamplesPerChunk
				break
			}
		}
		off := chunkOffsets[c]
		for k := uint32(0); k < per && s < n; k++ {
			t.off[s] = off
			off += uint64(t.size[s])
			s++
		}
	}
	if s != n {
		return nil, errors.New("chunk table doesn't cover every sample")
	}
	if trak.Edts != nil && len(trak.Edts.Elst) > 0 {
		for _, e := range trak.Edts.Elst[0].Entries {
			if e.MediaTime >= 0 {
				t.mediaTime = e.MediaTime
				break
			}
		}
	}
	return t, nil
}

func matrixRotation(m [9]int32) int {
	if m == ([9]int32{}) {
		return 0
	}
	a, b := float64(m[0]), float64(m[1])
	deg := int(math.Round(math.Atan2(b, a)*180/math.Pi)) % 360
	return ((deg + 360) % 360 / 90 * 90)
}

func rotationMatrix(deg int, w, h uint32) [9]int32 {
	const one = 0x10000
	switch (deg%360 + 360) % 360 {
	case 90:
		return [9]int32{0, one, 0, -one, 0, 0, int32(h), 0, 0x40000000}
	case 180:
		return [9]int32{-one, 0, 0, 0, -one, 0, int32(w), int32(h), 0x40000000}
	case 270:
		return [9]int32{0, -one, 0, one, 0, 0, 0, int32(w), 0x40000000}
	}
	return mp4.UnityMatrix()
}

func probeMP4(path string) (*Info, error) {
	fh, f, tracks, err := openMP4(path)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	info := &Info{Container: "mp4"}
	if mv := f.Moov.Mvhd; mv != nil && mv.Timescale > 0 {
		info.Duration = float64(mv.Duration) / float64(mv.Timescale)
	}
	for _, t := range tracks {
		stsd := t.trak.Mdia.Minf.Stbl.Stsd
		fourcc := ""
		if stsd != nil && len(stsd.Children) > 0 {
			fourcc = stsd.Children[0].Type()
		}
		trackDur := float64(t.end()) / float64(max(t.timescale, 1))
		switch t.handler {
		case "vide":
			if info.HasVideo {
				continue
			}
			info.HasVideo = true
			info.VideoCodec = codecName(fourcc)
			tk := t.trak.Tkhd
			info.Width, info.Height = int(tk.Width>>16), int(tk.Height>>16)
			info.Rotation = matrixRotation(tk.Matrix)
			if trackDur > 0 {
				info.FPS = math.Round(float64(t.n())/trackDur*100) / 100
			}
			for i := 0; i < t.n(); i++ {
				if t.isSync(i) {
					info.Keyframes = append(info.Keyframes, max(0, t.pts(i)))
				}
			}
			sort.Float64s(info.Keyframes)
		case "soun":
			if info.HasAudio {
				continue
			}
			info.HasAudio = true
			info.AudioCodec = codecName(fourcc)
			if a, ok := stsd.Children[0].(*mp4.AudioSampleEntryBox); ok {
				info.Channels, info.SampleRate = int(a.ChannelCount), int(a.SampleRate)
			}
		}
		if info.Duration == 0 {
			info.Duration = trackDur
		}
	}
	if !info.HasVideo && !info.HasAudio {
		return nil, fmt.Errorf("%w: no audio or video track", ErrNotEditable)
	}
	return info, nil
}

// --- remux ---

type outSample struct {
	track int
	src   int     // sample index in the source track
	dts   uint64  // output decode time (track timescale)
	sec   float64 // output decode time in seconds (for interleaving)
}

func remuxMP4(ctx context.Context, src string, plan Plan, w io.WriteSeeker, progress func(done, total int64)) ([][2]float64, error) {
	fh, f, tracks, err := openMP4(src)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	dur := 0.0
	if mv := f.Moov.Mvhd; mv != nil && mv.Timescale > 0 {
		dur = float64(mv.Duration) / float64(mv.Timescale)
	}
	// Which tracks are written.
	var keepTracks []int
	video := -1
	for i, t := range tracks {
		switch t.handler {
		case "vide":
			if plan.AudioOnly {
				continue
			}
			if video < 0 {
				video = i
			}
		case "soun":
			if plan.Mute {
				continue
			}
		default:
			if plan.AudioOnly {
				continue
			}
		}
		if t.n() > 0 {
			keepTracks = append(keepTracks, i)
		}
	}
	if len(keepTracks) == 0 {
		return nil, errors.New("no track left to write")
	}
	if dur == 0 {
		for _, i := range keepTracks {
			dur = max(dur, float64(tracks[i].end())/float64(tracks[i].timescale))
		}
	}
	keep := normalize(plan.Keep, dur+1)
	if len(keep) == 0 {
		return nil, errors.New("nothing left to save")
	}

	// Video decides the ranges: whole GOPs from the keyframe at/before each start
	// to the keyframe at/after each end.
	type span struct{ a, b int } // decode-order sample indices [a, b)
	var vspans []span
	var ranges [][2]float64 // presentation seconds actually kept
	if video >= 0 {
		t := tracks[video]
		for _, k := range keep {
			a, b := -1, t.n()
			for i := 0; i < t.n(); i++ {
				if t.isSync(i) && t.pts(i) <= k[0]+snapSlack {
					a = i
				}
			}
			if a < 0 {
				a = 0
			}
			for i := a + 1; i < t.n(); i++ {
				if t.isSync(i) && t.pts(i) >= k[1]-snapSlack {
					b = i
					break
				}
			}
			if n := len(vspans); n > 0 && a <= vspans[n-1].b {
				vspans[n-1].b = max(vspans[n-1].b, b)
			} else {
				vspans = append(vspans, span{a, b})
			}
		}
		for _, s := range vspans {
			endT := dur
			if s.b < t.n() {
				endT = t.pts(s.b)
			}
			ranges = append(ranges, [2]float64{max(0, t.pts(s.a)), endT})
		}
	} else {
		ranges = keep
	}

	// Output samples per track, with continuous decode times.
	out := make([][]outSample, len(tracks))
	var cursorSec float64 // output timeline position at the start of each range
	for ri, r := range ranges {
		rangeLen := r[1] - r[0]
		for _, ti := range keepTracks {
			t := tracks[ti]
			var idx []int
			if ti == video {
				for i := vspans[ri].a; i < vspans[ri].b; i++ {
					idx = append(idx, i)
				}
			} else {
				// Samples starting inside the range, as many as fill it.
				for i := 0; i < t.n(); i++ {
					p := t.pts(i)
					half := float64(t.dur[i]) / float64(t.timescale) / 2
					if p+half >= r[0] && p+half < r[1] {
						idx = append(idx, i)
					}
				}
			}
			if len(idx) == 0 {
				continue
			}
			prev := out[ti]
			var base uint64
			if len(prev) > 0 {
				last := prev[len(prev)-1]
				base = last.dts + uint64(t.dur[last.src])
			}
			// Align each range to the common cursor (drift from sample granularity
			// is corrected at every range start).
			want := uint64(math.Round(cursorSec * float64(t.timescale)))
			if ti != video && want > base {
				base = want
			}
			first := t.dts[idx[0]]
			for _, i := range idx {
				d := base + (t.dts[i] - first)
				out[ti] = append(out[ti], outSample{track: ti, src: i, dts: d, sec: float64(d) / float64(t.timescale)})
			}
		}
		cursorSec += rangeLen
	}

	// Interleave in ~0.5 s chunks per track, in decode-time order.
	type chunk struct {
		track   int
		samples []outSample
	}
	var chunks []chunk
	pos := make([]int, len(tracks))
	for {
		best, bestSec := -1, math.Inf(1)
		for _, ti := range keepTracks {
			if pos[ti] < len(out[ti]) && out[ti][pos[ti]].sec < bestSec {
				best, bestSec = ti, out[ti][pos[ti]].sec
			}
		}
		if best < 0 {
			break
		}
		start := pos[best]
		for pos[best] < len(out[best]) && out[best][pos[best]].sec < bestSec+0.5 {
			pos[best]++
		}
		chunks = append(chunks, chunk{best, out[best][start:pos[best]]})
	}

	// Rebuild sample tables.
	var mdatSize uint64
	for _, c := range chunks {
		for _, s := range c.samples {
			mdatSize += uint64(tracks[s.track].size[s.src])
		}
	}
	movieTS := f.Moov.Mvhd.Timescale
	use64 := mdatSize > math.MaxUint32-(64<<20)
	stcos := map[int]*[]uint64{}
	var movieDur uint64
	for _, ti := range keepTracks {
		t := tracks[ti]
		samples := out[ti]
		stbl := t.trak.Mdia.Minf.Stbl
		stts := &mp4.SttsBox{}
		for i, s := range samples {
			d := t.dur[s.src]
			if i+1 < len(samples) {
				d = uint32(samples[i+1].dts - s.dts)
			}
			if n := len(stts.SampleCount); n > 0 && stts.SampleTimeDelta[n-1] == d {
				stts.SampleCount[n-1]++
			} else {
				stts.SampleCount = append(stts.SampleCount, 1)
				stts.SampleTimeDelta = append(stts.SampleTimeDelta, d)
			}
		}
		var ctts *mp4.CttsBox
		if t.cto != nil {
			ctts = &mp4.CttsBox{}
			var counts []uint32
			var offs []int32
			neg := false
			for _, s := range samples {
				o := t.cto[s.src]
				neg = neg || o < 0
				if n := len(offs); n > 0 && offs[n-1] == o {
					counts[n-1]++
				} else {
					counts = append(counts, 1)
					offs = append(offs, o)
				}
			}
			if neg {
				ctts.Version = 1
			}
			if err := ctts.AddSampleCountsAndOffset(counts, offs); err != nil {
				return nil, err
			}
		}
		stsz := &mp4.StszBox{SampleNumber: uint32(len(samples))}
		for _, s := range samples {
			stsz.SampleSize = append(stsz.SampleSize, t.size[s.src])
		}
		var stss *mp4.StssBox
		if t.sync != nil {
			stss = &mp4.StssBox{}
			for i, s := range samples {
				if t.sync[s.src] {
					stss.SampleNumber = append(stss.SampleNumber, uint32(i+1))
				}
			}
		}
		stsc := &mp4.StscBox{}
		var offsets []uint64
		chunkNr := 0
		lastPer := uint32(0)
		for _, c := range chunks {
			if c.track != ti {
				continue
			}
			chunkNr++
			offsets = append(offsets, 0)
			if per := uint32(len(c.samples)); per != lastPer {
				if err := stsc.AddEntry(uint32(chunkNr), per, 1); err != nil {
					return nil, err
				}
				lastPer = per
			}
		}
		stcos[ti] = &offsets
		children := []mp4.Box{stbl.Stsd, stts}
		stbl.Stts, stbl.Ctts, stbl.Stsc, stbl.Stsz, stbl.Stss, stbl.Stco, stbl.Co64 = stts, ctts, stsc, stsz, stss, nil, nil
		stbl.Sdtp, stbl.Sbgp, stbl.Sbgps, stbl.Sgpd, stbl.Sgpds, stbl.Subs, stbl.Saio, stbl.Saiz = nil, nil, nil, nil, nil, nil, nil, nil
		if ctts != nil {
			children = append(children, ctts)
		}
		children = append(children, stsc, stsz)
		if stss != nil {
			children = append(children, stss)
		}
		if use64 {
			stbl.Co64 = &mp4.Co64Box{ChunkOffset: offsets}
			children = append(children, stbl.Co64)
		} else {
			stbl.Stco = &mp4.StcoBox{ChunkOffset: make([]uint32, len(offsets))}
			children = append(children, stbl.Stco)
		}
		stbl.Children = children

		// Durations and the edit list (presentation starts at the first sample).
		last := samples[len(samples)-1]
		mediaDur := last.dts + uint64(t.dur[last.src])
		t.trak.Mdia.Mdhd.Duration = mediaDur
		mediaTime := int64(0)
		if t.cto != nil {
			mediaTime = int64(t.cto[samples[0].src])
		}
		if ti != video && samples[0].src == 0 {
			mediaTime = t.mediaTime // keep encoder priming skipped
		}
		presDur := uint64(max(0, int64(mediaDur)-mediaTime))
		trackDur := presDur * uint64(movieTS) / uint64(t.timescale)
		t.trak.Tkhd.Duration = trackDur
		movieDur = max(movieDur, trackDur)
		elst := &mp4.ElstBox{Entries: []mp4.ElstEntry{{SegmentDuration: trackDur, MediaTime: mediaTime, MediaRateInteger: 1}}}
		if trackDur > math.MaxUint32 || mediaTime > math.MaxInt32 {
			elst.Version = 1
		}
		edts := &mp4.EdtsBox{Elst: []*mp4.ElstBox{elst}, Children: []mp4.Box{elst}}
		var tc []mp4.Box
		for _, c := range t.trak.Children {
			switch c.Type() {
			case "edts":
				continue
			case "tkhd":
				tc = append(tc, c, edts)
				continue
			}
			tc = append(tc, c)
		}
		t.trak.Children, t.trak.Edts = tc, edts
		if ti == video && plan.Rotate%360 != 0 {
			tk := t.trak.Tkhd
			tk.Matrix = rotationMatrix(matrixRotation(tk.Matrix)+plan.Rotate, uint32(tk.Width), uint32(tk.Height))
		}
	}
	// Drop tracks that aren't written.
	written := map[*mp4.TrakBox]bool{}
	for _, ti := range keepTracks {
		written[tracks[ti].trak] = true
	}
	var moovChildren []mp4.Box
	var traks []*mp4.TrakBox
	for _, c := range f.Moov.Children {
		if tr, ok := c.(*mp4.TrakBox); ok {
			if !written[tr] {
				continue
			}
			traks = append(traks, tr)
		}
		if c.Type() == "mvex" { // the output isn't fragmented
			continue
		}
		moovChildren = append(moovChildren, c)
	}
	f.Moov.Children, f.Moov.Traks, f.Moov.Trak, f.Moov.Mvex = moovChildren, traks, traks[0], nil
	f.Moov.Mvhd.Duration = movieDur

	// Layout: ftyp, moov, mdat. Offsets depend on the moov size, which
	// doesn't change when offsets are filled in (fixed-width entries).
	var head bytes.Buffer
	if f.Ftyp != nil && !f.IsFragmented() {
		if err := f.Ftyp.Encode(&head); err != nil {
			return nil, err
		}
	} else if err := mp4.NewFtyp("isom", 512, []string{"isom", "iso2", "mp41"}).Encode(&head); err != nil {
		return nil, err
	}
	mdatHeader := uint64(8)
	if mdatSize+8 > math.MaxUint32 {
		mdatHeader = 16
	}
	dataStart := uint64(head.Len()) + f.Moov.Size() + mdatHeader
	off := dataStart
	chunkIdx := map[int]int{}
	for _, c := range chunks {
		k := chunkIdx[c.track]
		(*stcos[c.track])[k] = off
		chunkIdx[c.track] = k + 1
		for _, s := range c.samples {
			off += uint64(tracks[s.track].size[s.src])
		}
	}
	for _, ti := range keepTracks {
		stbl := tracks[ti].trak.Mdia.Minf.Stbl
		offs := *stcos[ti]
		if use64 {
			stbl.Co64.ChunkOffset = offs
		} else {
			for i, o := range offs {
				stbl.Stco.ChunkOffset[i] = uint32(o)
			}
		}
	}
	bw := bufio.NewWriterSize(w, 1<<20)
	if _, err := bw.Write(head.Bytes()); err != nil {
		return nil, err
	}
	if err := f.Moov.Encode(bw); err != nil {
		return nil, err
	}
	if mdatHeader == 16 {
		var h [16]byte
		binary.BigEndian.PutUint32(h[0:], 1)
		copy(h[4:], "mdat")
		binary.BigEndian.PutUint64(h[8:], mdatSize+16)
		bw.Write(h[:])
	} else {
		var h [8]byte
		binary.BigEndian.PutUint32(h[0:], uint32(mdatSize+8))
		copy(h[4:], "mdat")
		bw.Write(h[:])
	}
	buf := make([]byte, 256<<10)
	var done uint64
	for _, c := range chunks {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		t := tracks[c.track]
		for _, s := range c.samples {
			n := int(t.size[s.src])
			if cap(buf) < n {
				buf = make([]byte, n)
			}
			if _, err := fh.ReadAt(buf[:n], int64(t.off[s.src])); err != nil {
				return nil, fmt.Errorf("reading sample: %w", err)
			}
			if _, err := bw.Write(buf[:n]); err != nil {
				return nil, err
			}
			done += uint64(n)
		}
		if progress != nil {
			progress(int64(done), int64(mdatSize))
		}
	}
	if err := bw.Flush(); err != nil {
		return nil, err
	}
	return ranges, nil
}
