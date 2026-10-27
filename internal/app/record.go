package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/caffeine-runtime/monoform/internal/server"
	"github.com/caffeine-runtime/monoform/internal/video"
)

// Screen recording. The recorder is a small window of its own (monoform
// --record; Wails v2 has one window per process), so the editor stays as it
// is. Its webview records the screen or window chosen in the system's
// "Choose what to share" step and streams the pieces here as it goes: a
// crash or power cut loses seconds, not the recording. When it stops, the
// pieces (a fragmented MP4, or WebM) are rewritten into an ordinary file
// with a duration and seek index, and the main window opens it.

// recordingsDir is where recordings are saved: Videos/Screen Recordings
// (where Windows' Snipping Tool puts them too).
func recordingsDir() string {
	if d := os.Getenv("MF_RECORDINGS"); d != "" {
		return d
	}
	// Self-tests never write into the user's Videos.
	if os.Getenv("MF_TEST") != "" {
		return filepath.Join(os.TempDir(), "monoform-selftest", "Screen Recordings")
	}
	if d := knownVideos(); d != "" {
		return filepath.Join(d, "Screen Recordings")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return os.TempDir()
	}
	return filepath.Join(home, "Videos", "Screen Recordings")
}

// RecordingsFolder is where recordings are saved (shown in the recorder).
func (a *App) RecordingsFolder() string { return recordingsDir() }

// OpenMicrophoneSettings opens the system's microphone privacy settings
// (when Windows doesn't let apps use the microphone).
func (a *App) OpenMicrophoneSettings() error { return openMicrophoneSettings() }

// recordingName is a new recording's file name, like a screenshot's.
func recordingName(at time.Time, ext string) string {
	return "Screen recording " + at.Format("2006-01-02 at 15.04.05") + "." + ext
}

// freePath returns path, or path with " (2)", " (3)"… before the extension
// when it is taken.
func freePath(path string) string {
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(path, ext)
	for i := 1; ; i++ {
		p := path
		if i > 1 {
			p = fmt.Sprintf("%s (%d)%s", base, i, ext)
		}
		if _, err := os.Lstat(p); errors.Is(err, os.ErrNotExist) {
			return p
		}
	}
}

type recording struct {
	mu      sync.Mutex
	f       *os.File
	part    string // what is written while recording
	dest    string // the finished file
	written int64
}

var rec recording

// RecordScreen opens the recorder window. Only one runs at a time: a
// second start brings the open one forward.
func (a *App) RecordScreen() error {
	if os.Getenv("MF_TEST") != "" {
		handoff.Lock()
		handoff.last = []string{"--record"}
		handoff.Unlock()
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "--record")
	cmd.Env = childEnv(os.Environ())
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// RecordBegin starts a recording file for ext ("mp4" or "webm") and
// returns the path the finished recording will have. The pieces go to a
// hidden file next to it (POST /__mf/record/chunk).
func (a *App) RecordBegin(ext string) (string, error) {
	if ext != "mp4" && ext != "webm" {
		return "", fmt.Errorf("unsupported recording format %q", ext)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if rec.f != nil {
		return "", errors.New("a recording is already running")
	}
	dir := recordingsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dest := freePath(filepath.Join(dir, recordingName(time.Now(), ext)))
	part := filepath.Join(dir, "."+filepath.Base(dest)+".part")
	f, err := os.Create(part)
	if err != nil {
		return "", err
	}
	hideFile(part)
	rec.f, rec.part, rec.dest, rec.written = f, part, dest, 0
	return dest, nil
}

// appendChunk adds recorded bytes to the running recording.
func (r *recording) appendChunk(body io.Reader) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return 0, errors.New("no recording is running")
	}
	n, err := io.Copy(r.f, body)
	r.written += n
	return r.written, err
}

// take ends the running recording's file and returns its paths.
func (r *recording) take() (part, dest string, written int64, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return "", "", 0, errors.New("no recording is running")
	}
	err = r.f.Close()
	part, dest, written = r.part, r.dest, r.written
	r.f, r.part, r.dest, r.written = nil, "", "", 0
	return part, dest, written, err
}

// RecordFinish ends the recording and writes the finished file (with a
// duration and seek index). If that fails, the pieces are kept as they are
// (they still play) rather than lost.
func (a *App) RecordFinish() (string, error) {
	part, dest, written, err := rec.take()
	if err != nil {
		return "", err
	}
	if written == 0 {
		os.Remove(part)
		return "", errors.New("nothing was recorded")
	}
	return finishRecording(part, dest)
}

func finishRecording(part, dest string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if _, err := video.Export(ctx, part, video.Plan{Keep: [][2]float64{{0, 1e9}}}, dest, nil); err != nil {
		log.Printf("record: finishing %s failed (%v); keeping the recording as recorded", dest, err)
		if err := os.Rename(part, dest); err != nil {
			return "", err
		}
		unhideFile(dest)
		return dest, nil
	}
	os.Remove(part)
	return dest, nil
}

// RecordDiscard throws the running recording away.
func (a *App) RecordDiscard() error {
	part, _, _, err := rec.take()
	if part != "" {
		os.Remove(part)
	}
	return err
}

// RecordOpen hands a finished recording to the main window, which opens it
// in the video editor (or starts as the main window when none is open).
func (a *App) RecordOpen(path string) error {
	if os.Getenv("MF_TEST") != "" {
		handoff.Lock()
		handoff.last = []string{"--recorded", path}
		handoff.Unlock()
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "--recorded", path)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// RecorderLayout shapes the recorder window: "panel" (the options, centred)
// or "bar" (the small controls while recording: at the bottom of the
// screen, above other windows and left out of the recording itself). w, h
// are in CSS pixels.
func (a *App) RecorderLayout(layout string, w, h int) {
	if a.ctx == nil {
		return
	}
	was := a.recorderLayout
	a.recorderLayout = layout
	switch layout {
	case "bar":
		if was == "bar" {
			// Same place, wherever it was dragged: only the width changes,
			// around the middle.
			x, y := wruntime.WindowGetPosition(a.ctx)
			ow, _ := wruntime.WindowGetSize(a.ctx)
			wruntime.WindowSetSize(a.ctx, w, h)
			wruntime.WindowSetPosition(a.ctx, x+(ow-w)/2, y)
			return
		}
		wruntime.WindowSetSize(a.ctx, w, h)
		sw, sh := screenSize(a.ctx)
		wruntime.WindowSetPosition(a.ctx, max(0, (sw-w)/2), max(0, sh-h-barMargin))
		wruntime.WindowSetAlwaysOnTop(a.ctx, true)
		if os.Getenv("MF_TEST_KEEP_WINDOW") == "" {
			excludeFromCapture(true)
		}
	default:
		wruntime.WindowSetSize(a.ctx, w, h)
		wruntime.WindowSetAlwaysOnTop(a.ctx, false)
		excludeFromCapture(false)
		wruntime.WindowCenter(a.ctx)
	}
	wruntime.WindowShow(a.ctx)
}

// barMargin keeps the bar clear of the taskbar.
const barMargin = 72

func screenSize(ctx context.Context) (int, int) {
	sw, sh := 1920, 1080
	if screens, err := wruntime.ScreenGetAll(ctx); err == nil {
		for _, s := range screens {
			if s.IsCurrent || s.IsPrimary {
				sw, sh = s.Size.Width, s.Size.Height
				if s.IsCurrent {
					break
				}
			}
		}
	}
	return sw, sh
}

// registerRecordRoutes adds the endpoint recorded pieces are streamed to.
func (a *App) registerRecordRoutes() {
	a.Server.Handle("POST /__mf/record/chunk", func(w http.ResponseWriter, r *http.Request) {
		n, err := rec.appendChunk(http.MaxBytesReader(w, r.Body, 256<<20))
		if err != nil {
			server.Error(w, http.StatusConflict, err)
			return
		}
		server.JSON(w, map[string]int64{"written": n})
	})
}
