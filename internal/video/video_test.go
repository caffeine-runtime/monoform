package video

import (
	"context"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func near(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

// ffmpegCheck decodes every frame with ffmpeg (when installed) and returns
// its error output and the number of video frames.
func ffmpegCheck(t *testing.T, path string) (string, int) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return "", -1
	}
	out, _ := exec.Command("ffmpeg", "-v", "error", "-i", path, "-f", "null", "-").CombinedOutput()
	n := -1
	if b, err := exec.Command("ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path).Output(); err == nil {
		n, _ = strconv.Atoi(strings.TrimSpace(string(b)))
	}
	return strings.TrimSpace(string(out)), n
}

func TestProbe(t *testing.T) {
	cases := []struct {
		file, container, vcodec, acodec string
		w, h                            int
		dur                             float64
	}{
		{"clip.webm", "matroska", "VP9", "Opus", 320, 180, 6},
		{"clip.mp4", "mp4", "VP9", "Opus", 320, 180, 6},
		{"h264.mp4", "mp4", "H.264", "AAC", 160, 90, 6},
		{"clip.mkv", "matroska", "VP8", "Vorbis", 160, 90, 4},
	}
	for _, c := range cases {
		info, err := Probe(filepath.Join("testdata", c.file))
		if err != nil {
			t.Fatal(err)
		}
		if !info.Editable || info.Container != c.container || info.VideoCodec != c.vcodec || info.AudioCodec != c.acodec || info.Width != c.w || info.Height != c.h {
			t.Errorf("%s: %+v", c.file, info)
		}
		if !near(info.Duration, c.dur, 0.1) || !near(info.FPS, 25, 0.5) {
			t.Errorf("%s: duration %.3f fps %.2f", c.file, info.Duration, info.FPS)
		}
		if n := len(info.Keyframes); n < int(c.dur)-1 || info.Keyframes[0] > 0.05 {
			t.Errorf("%s: keyframes %v", c.file, info.Keyframes)
		}
	}
	if info, err := Probe(filepath.Join("..", "audio", "testdata", "tone.mp3")); err != nil || info.Editable || info.Reason == "" {
		t.Errorf("an MP3 isn't an editable video: %+v %v", info, err)
	}
}

func TestSnap(t *testing.T) {
	got := Snap([][2]float64{{4.2, 5.5}, {1.3, 2.6}, {2.5, 2.9}}, []float64{0, 1, 2, 3, 4, 5}, 6)
	if len(got) != 2 || got[0] != [2]float64{1, 3} || got[1] != [2]float64{4, 6} {
		t.Fatalf("snap %v", got)
	}
}

func TestCut(t *testing.T) {
	for _, file := range []string{"clip.webm", "clip.mp4", "h264.mp4", "clip.mkv"} {
		t.Run(file, func(t *testing.T) {
			src := filepath.Join("testdata", file)
			in, _ := Probe(src)
			out := filepath.Join(t.TempDir(), "out"+filepath.Ext(file))
			kept, err := Export(context.Background(), src, Plan{Keep: [][2]float64{{1.3, 2.6}, {3.2, 3.5}}}, out, nil)
			if err != nil {
				t.Fatal(err)
			}
			want := Snap([][2]float64{{1.3, 2.6}, {3.2, 3.5}}, in.Keyframes, in.Duration)
			if len(kept) != len(want) {
				t.Fatalf("kept %v, snap predicted %v", kept, want)
			}
			var length float64
			for i := range kept {
				if !near(kept[i][0], want[i][0], 0.05) || !near(kept[i][1], want[i][1], 0.05) {
					t.Fatalf("kept %v, snap predicted %v", kept, want)
				}
				length += kept[i][1] - kept[i][0]
			}
			info, err := Probe(out)
			if err != nil || !info.Editable {
				t.Fatalf("output unreadable: %+v %v", info, err)
			}
			if !near(info.Duration, length, 0.1) || !info.HasAudio || !info.HasVideo {
				t.Errorf("output %+v, expected %.2f s", info, length)
			}
			if errs, frames := ffmpegCheck(t, out); frames >= 0 {
				if errs != "" {
					t.Errorf("ffmpeg decode errors: %s", errs)
				}
				if !near(float64(frames), length*25, 2) {
					t.Errorf("%d frames, expected %.0f", frames, length*25)
				}
			}
		})
	}
}

func TestMuteAudioOnlyRotate(t *testing.T) {
	dir := t.TempDir()
	for _, file := range []string{"clip.webm", "h264.mp4"} {
		src := filepath.Join("testdata", file)
		ext := filepath.Ext(file)
		muted := filepath.Join(dir, "muted"+ext)
		if _, err := Export(context.Background(), src, Plan{Keep: [][2]float64{{0, 6}}, Mute: true}, muted, nil); err != nil {
			t.Fatal(err)
		}
		if info, _ := Probe(muted); info.HasAudio || !info.HasVideo || !near(info.Duration, 6, 0.1) {
			t.Errorf("%s muted: %+v", file, info)
		}
		audio := filepath.Join(dir, "audio"+ext)
		if _, err := Export(context.Background(), src, Plan{Keep: [][2]float64{{0, 6}}, AudioOnly: true}, audio, nil); err != nil {
			t.Fatal(err)
		}
		if info, _ := Probe(audio); !info.HasAudio || info.HasVideo || !near(info.Duration, 6, 0.1) {
			t.Errorf("%s audio only: %+v", file, info)
		}
		if errs, _ := ffmpegCheck(t, audio); errs != "" {
			t.Errorf("%s audio only: ffmpeg: %s", file, errs)
		}
	}
	rot := filepath.Join(dir, "rot.mp4")
	if _, err := Export(context.Background(), filepath.Join("testdata", "h264.mp4"), Plan{Keep: [][2]float64{{0, 6}}, Rotate: 90}, rot, nil); err != nil {
		t.Fatal(err)
	}
	if info, _ := Probe(rot); info.Rotation != 90 {
		t.Errorf("rotation %d", info.Rotation)
	}
	if _, err := exec.LookPath("ffprobe"); err == nil {
		b, _ := exec.Command("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream_side_data=rotation", "-of", "csv=p=0", rot).Output()
		if r := strings.TrimSpace(string(b)); r != "-90" && r != "90" {
			t.Errorf("ffprobe rotation %q", r)
		}
	}
	if _, err := Export(context.Background(), filepath.Join("testdata", "clip.webm"), Plan{Keep: [][2]float64{{0, 6}}, Rotate: 90}, filepath.Join(dir, "r.webm"), nil); err == nil {
		t.Error("WebM rotation should be refused")
	}
}
