// Package video probes video files and edits them without re-encoding:
// keep parts (cut points snap to keyframes), rotate (MP4/MOV), drop the
// audio, or extract the audio track. MP4/MOV go through mp4ff; WebM/MKV
// through a small Matroska reader/writer of our own.
//
// Re-encoding isn't offered: there is no permissively licensed H.264/HEVC
// encoder in pure Go, and the webviews' WebCodecs encoders differ by
// platform (VP8/VP9 only on WebKitGTK, H.264 only where the OS has it).
package video

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	hfs "github.com/caffeine-runtime/hold-it-all/internal/fs"
)

// Info describes a video file for the player and editor.
type Info struct {
	Container  string    `json:"container"` // "mp4" (MP4/MOV/M4V) or "matroska" (WebM/MKV)
	Editable   bool      `json:"editable"`
	Reason     string    `json:"reason,omitempty"`
	Duration   float64   `json:"duration"`
	Width      int       `json:"width"`
	Height     int       `json:"height"`
	Rotation   int       `json:"rotation"` // degrees clockwise stored in the file (MP4)
	FPS        float64   `json:"fps"`
	VideoCodec string    `json:"videoCodec"`
	AudioCodec string    `json:"audioCodec"`
	Channels   int       `json:"channels"`
	SampleRate int       `json:"sampleRate"`
	Bitrate    int       `json:"bitrate"` // kbit/s overall
	HasVideo   bool      `json:"hasVideo"`
	HasAudio   bool      `json:"hasAudio"`
	Keyframes  []float64 `json:"keyframes"` // seconds, presentation time
	Title      string    `json:"title,omitempty"`
}

// Plan is what to write.
type Plan struct {
	Keep      [][2]float64 `json:"keep"`      // seconds of the source; cut points snap to keyframes
	Rotate    int          `json:"rotate"`    // extra clockwise rotation: 0, 90, 180, 270 (MP4/MOV only)
	Mute      bool         `json:"mute"`      // drop audio tracks
	AudioOnly bool         `json:"audioOnly"` // drop video tracks
}

// ErrNotEditable marks files we can play but not edit.
var ErrNotEditable = errors.New("this video can be played but not edited")

func sniff(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	head := make([]byte, 12)
	if _, err := io.ReadFull(f, head); err != nil {
		return "", fmt.Errorf("%w: file too short", ErrNotEditable)
	}
	switch {
	case string(head[:4]) == "\x1a\x45\xdf\xa3":
		return "matroska", nil
	case string(head[4:8]) == "ftyp" || string(head[4:8]) == "moov" || string(head[4:8]) == "mdat" || string(head[4:8]) == "wide" || string(head[4:8]) == "free":
		return "mp4", nil
	}
	return "", fmt.Errorf("%w (only MP4/MOV and WebM/MKV files can be edited)", ErrNotEditable)
}

// Probe reads a file's structure (no decoding).
func Probe(path string) (*Info, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	kind, err := sniff(path)
	var info *Info
	if err == nil {
		switch kind {
		case "mp4":
			info, err = probeMP4(path)
		case "matroska":
			info, err = probeMKV(path)
		}
	}
	if err != nil {
		if !errors.Is(err, ErrNotEditable) {
			return nil, err
		}
		return &Info{Reason: err.Error(), Keyframes: []float64{}}, nil
	}
	info.Editable = true
	if info.Duration > 0 {
		info.Bitrate = int(float64(st.Size()*8) / info.Duration / 1000)
	}
	if info.Keyframes == nil {
		info.Keyframes = []float64{}
	}
	return info, nil
}

// normalize sorts and merges keep ranges.
func normalize(keep [][2]float64, dur float64) [][2]float64 {
	var out [][2]float64
	for _, k := range keep {
		a, b := max(0, min(k[0], k[1])), min(dur, max(k[0], k[1]))
		if b > a {
			out = append(out, [2]float64{a, b})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i][0] < out[j][0] })
	var merged [][2]float64
	for _, k := range out {
		if n := len(merged); n > 0 && k[0] <= merged[n-1][1] {
			merged[n-1][1] = max(merged[n-1][1], k[1])
		} else {
			merged = append(merged, k)
		}
	}
	return merged
}

// snapSlack lets a cut land on a keyframe this close after (or before) the
// requested point instead of taking in a whole extra group of pictures.
const snapSlack = 0.05

// Snap returns the ranges actually written: starts move back to the previous
// keyframe, ends forward to the next one (or the end).
func Snap(keep [][2]float64, keyframes []float64, dur float64) [][2]float64 {
	keep = normalize(keep, dur)
	if len(keyframes) == 0 {
		return keep
	}
	var out [][2]float64
	for _, k := range keep {
		a, b := keyframes[0], dur
		for _, t := range keyframes {
			if t <= k[0]+snapSlack {
				a = t
			}
		}
		for _, t := range keyframes {
			if t >= k[1]-snapSlack {
				b = t
				break
			}
		}
		if b > a {
			out = append(out, [2]float64{a, b})
		}
	}
	return normalize(out, dur)
}

// Export writes the plan atomically (temp file + rename) and returns the
// ranges actually kept.
func Export(ctx context.Context, src string, plan Plan, dest string, progress func(done, total int64)) ([][2]float64, error) {
	kind, err := sniff(src)
	if err != nil {
		return nil, err
	}
	if plan.Mute && plan.AudioOnly {
		return nil, errors.New("nothing to write: both video and audio removed")
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), "."+filepath.Base(dest)+".*.tmp")
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	var kept [][2]float64
	switch kind {
	case "mp4":
		kept, err = remuxMP4(ctx, src, plan, tmp, progress)
	case "matroska":
		if plan.Rotate%360 != 0 {
			return nil, errors.New("rotation can only be saved in MP4/MOV files (WebM/MKV have no standard rotation flag)")
		}
		kept, err = remuxMKV(ctx, src, plan, tmp, progress)
	}
	if err != nil {
		return nil, err
	}
	mode := os.FileMode(0o644)
	if st, err := os.Stat(dest); err == nil {
		mode = st.Mode().Perm()
	}
	if err := tmp.Chmod(mode); err != nil {
		return nil, err
	}
	if err := tmp.Sync(); err != nil {
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	if err := hfs.ReplaceFile(tmp.Name(), dest); err != nil {
		return nil, err
	}
	ok = true
	return kept, nil
}
