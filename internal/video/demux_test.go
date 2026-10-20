package video

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestDemux(t *testing.T) {
	cases := []struct {
		file, vcodec, acodec string
		desc                 bool // video needs a decoder description (avcC)
	}{
		{"clip.webm", "vp09.00.10.08", "opus", false},
		{"clip.mp4", "vp09.", "opus", false},
		{"h264.mp4", "avc1.", "mp4a.40.2", true},
		{"clip.mkv", "vp8", "vorbis", false},
	}
	for _, c := range cases {
		path := filepath.Join("testdata", c.file)
		d, err := DemuxFile(path)
		if err != nil {
			t.Fatal(c.file, err)
		}
		if len(d.Streams) != 2 || d.Streams[0].Kind != "video" || d.Streams[1].Kind != "audio" {
			t.Fatalf("%s: streams %+v", c.file, d.Streams)
		}
		v, a := d.Streams[0], d.Streams[1]
		if !strings.HasPrefix(v.Codec, c.vcodec) || !strings.HasPrefix(a.Codec, c.acodec) || (len(v.Description) > 0) != c.desc {
			t.Errorf("%s: codecs %q %q desc %d", c.file, v.Codec, a.Codec, len(v.Description))
		}
		if v.Width == 0 || a.SampleRate == 0 || a.Channels == 0 {
			t.Errorf("%s: sizes %dx%d %d Hz %d ch", c.file, v.Width, v.Height, a.SampleRate, a.Channels)
		}
		if len(v.Samples) < 90 || v.Samples[0][4] != 1 {
			t.Errorf("%s: %d video samples, first key %v", c.file, len(v.Samples), v.Samples[0][4])
		}
		data, _ := os.ReadFile(path)
		for _, s := range append(append([][5]float64{}, v.Samples...), a.Samples...) {
			if s[3] <= 0 || int(s[2]+s[3]) > len(data) || s[1] <= 0 {
				t.Fatalf("%s: bad sample %v", c.file, s)
			}
		}
		// Keyframe flags agree with the bitstream (VP8/VP9 headers).
		for _, s := range v.Samples[:10] {
			b := data[int(s[2])]
			switch {
			case c.vcodec == "vp8" && (b&1 == 0) != (s[4] == 1):
				t.Errorf("%s: VP8 key flag mismatch at %.2f", c.file, s[0])
			case strings.HasPrefix(c.vcodec, "vp09") && b>>6 != 2:
				t.Errorf("%s: no VP9 frame marker at %.2f", c.file, s[0])
			}
		}
		// Packet sizes match ffprobe's, in order, when it is installed.
		if _, err := exec.LookPath("ffprobe"); err == nil {
			for i, st := range []Stream{v, a} {
				out, err := exec.Command("ffprobe", "-v", "error", "-select_streams", []string{"v:0", "a:0"}[i], "-show_entries", "packet=size", "-of", "csv=p=0", path).Output()
				if err != nil {
					t.Fatal(err)
				}
				var want []int
				for _, l := range strings.Fields(string(out)) {
					n, _ := strconv.Atoi(strings.TrimSuffix(l, ","))
					want = append(want, n)
				}
				if len(want) != len(st.Samples) {
					t.Errorf("%s %s: %d samples, ffprobe %d", c.file, st.Kind, len(st.Samples), len(want))
					continue
				}
				for k := range want {
					if int(st.Samples[k][3]) != want[k] {
						t.Errorf("%s %s: sample %d size %v, ffprobe %d", c.file, st.Kind, k, st.Samples[k][3], want[k])
						break
					}
				}
			}
		}
	}
}

func TestLaces(t *testing.T) {
	// Xiph: 3 frames of 2, 300 and the rest.
	p := append([]byte{2, 2, 255, 45}, make([]byte, 2+300+5)...)
	l, err := mkvLaces(0x02, p)
	if err != nil || len(l) != 3 || l[0] != [2]int{4, 2} || l[1] != [2]int{6, 300} || l[2] != [2]int{306, 5} {
		t.Errorf("xiph %v %v", l, err)
	}
	// Fixed: 2 frames of 4.
	l, err = mkvLaces(0x04, append([]byte{1}, make([]byte, 8)...))
	if err != nil || len(l) != 2 || l[1] != [2]int{5, 4} {
		t.Errorf("fixed %v %v", l, err)
	}
	// EBML: 3 frames: 10, 10+(-2)=8, rest 5.
	q := append([]byte{2, 0x8A, 0xBD}, make([]byte, 10+8+5)...)
	l, err = mkvLaces(0x06, q)
	if err != nil || len(l) != 3 || l[0] != [2]int{3, 10} || l[1] != [2]int{13, 8} || l[2] != [2]int{21, 5} {
		t.Errorf("ebml %v %v", l, err)
	}
	if _, err := mkvLaces(0x02, []byte{1, 200}); err == nil {
		t.Error("oversized lace accepted")
	}
}
