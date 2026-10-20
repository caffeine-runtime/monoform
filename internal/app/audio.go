package app

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/caffeine-runtime/hold-it-all/internal/audio"
	"github.com/caffeine-runtime/hold-it-all/internal/jobs"
	"github.com/caffeine-runtime/hold-it-all/internal/media"
	"github.com/caffeine-runtime/hold-it-all/internal/server"
)

// An audio session is one open audio tab: its file's info, the waveform
// peaks (computed in the background and polled by the frontend) and the
// loopback URL the <audio> element plays.
type audioSession struct {
	path   string
	info   *audio.Info
	cover  *audio.Picture
	url    string
	cancel context.CancelFunc

	mu    sync.Mutex
	peaks []int16
	done  bool
	err   string
}

var (
	audioMu       sync.Mutex
	audioSessions = map[string]*audioSession{}
	mediaOnce     sync.Once
	mediaServer   *media.Server
)

func (a *App) media() *media.Server {
	mediaOnce.Do(func() {
		// Page origins on Linux/macOS (wails://) and Windows (WebView2).
		mediaServer = media.New("wails://wails", "https://wails.localhost", "http://wails.localhost")
	})
	return mediaServer
}

// AudioOpened is what the audio module needs to show a file.
type AudioOpened struct {
	ID    string      `json:"id"`
	Info  *audio.Info `json:"info"`
	URL   string      `json:"url"`
	Lanes int         `json:"lanes"`
}

// AudioOpen probes the file, starts computing its waveform and registers it
// for playback.
func (a *App) AudioOpen(path string) (*AudioOpened, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("absolute path required")
	}
	info, cover, err := audio.Probe(path)
	if err != nil {
		return nil, err
	}
	url, err := a.media().Register(path)
	if err != nil {
		return nil, err
	}
	b := make([]byte, 8)
	rand.Read(b)
	id := hex.EncodeToString(b)
	ctx, cancel := context.WithCancel(context.Background())
	s := &audioSession{path: path, info: info, cover: cover, url: url, cancel: cancel}
	audioMu.Lock()
	audioSessions[id] = s
	audioMu.Unlock()
	lanes := min(max(info.Channels, 1), 2)
	if info.Editable {
		go s.computePeaks(ctx)
	} else {
		s.done = true
	}
	return &AudioOpened{ID: id, Info: info, URL: url, Lanes: lanes}, nil
}

func (s *audioSession) computePeaks(ctx context.Context) {
	err := audio.PeaksFile(ctx, s.path, func(b []int16) {
		s.mu.Lock()
		s.peaks = append(s.peaks, b...)
		s.mu.Unlock()
	})
	s.mu.Lock()
	s.done = true
	if err != nil && !errors.Is(err, context.Canceled) {
		s.err = err.Error()
	}
	s.mu.Unlock()
}

// AudioClose ends a session (tab closed or file reloaded).
func (a *App) AudioClose(id string) {
	audioMu.Lock()
	s := audioSessions[id]
	delete(audioSessions, id)
	audioMu.Unlock()
	if s != nil {
		s.cancel()
		a.media().Release(s.url)
	}
}

func lookupAudio(id string) (*audioSession, error) {
	audioMu.Lock()
	defer audioMu.Unlock()
	if s := audioSessions[id]; s != nil {
		return s, nil
	}
	return nil, errors.New("audio file is no longer open")
}

// AudioExport renders the edits into dest (WAV, FLAC, or a lossless MP3 cut)
// as a background job.
func (a *App) AudioExport(id string, segs []audio.Segment, dest string, opt audio.ExportOptions) (string, error) {
	s, err := lookupAudio(id)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(dest) {
		return "", errors.New("absolute path required")
	}
	return a.Jobs.Start("audio-export", "Saving "+filepath.Base(dest), func(ctx context.Context, r *jobs.Reporter) (any, error) {
		if a.watcher != nil {
			a.watcher.NoteOwnWrite(dest)
		}
		err := audio.Export(ctx, s.path, segs, dest, opt, func(done, total int64) { r.Set(done, total, "") })
		if a.watcher != nil {
			a.watcher.NoteOwnWrite(dest)
		}
		return dest, err
	}), nil
}

// AudioAnalyze measures the peak level of the edited audio (job result: float).
func (a *App) AudioAnalyze(id string, segs []audio.Segment) (string, error) {
	s, err := lookupAudio(id)
	if err != nil {
		return "", err
	}
	return a.Jobs.Start("audio-analyze", "Measuring level", func(ctx context.Context, r *jobs.Reporter) (any, error) {
		return audio.Analyze(ctx, s.path, segs, func(done, total int64) { r.Set(done, total, "") })
	}), nil
}

// MediaURL registers any audio/video file for playback and returns its loopback URL.
func (a *App) MediaURL(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", errors.New("absolute path required")
	}
	return a.media().Register(path)
}

// MediaRelease forgets a URL returned by MediaURL.
func (a *App) MediaRelease(url string) { a.media().Release(url) }

func (a *App) registerAudioRoutes() {
	// Waveform peaks from bucket ?from= on, as little-endian int16
	// (lane-major min/max pairs). X-Done says whether more will come.
	a.Server.Handle("GET /__hia/audio/peaks", func(w http.ResponseWriter, r *http.Request) {
		s, err := lookupAudio(r.URL.Query().Get("id"))
		if err != nil {
			server.Error(w, http.StatusNotFound, err)
			return
		}
		from, _ := strconv.Atoi(r.URL.Query().Get("from"))
		lanes := min(max(s.info.Channels, 1), 2)
		s.mu.Lock()
		off := min(max(from, 0)*lanes*2, len(s.peaks))
		part := append([]int16(nil), s.peaks[off:]...)
		done, perr := s.done, s.err
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
		if done {
			w.Header().Set("X-Done", "1")
		}
		if perr != "" {
			w.Header().Set("X-Error", perr)
		}
		buf := make([]byte, len(part)*2)
		for i, v := range part {
			binary.LittleEndian.PutUint16(buf[i*2:], uint16(v))
		}
		w.Write(buf)
	})
	a.Server.Handle("GET /__hia/audio/cover", func(w http.ResponseWriter, r *http.Request) {
		s, err := lookupAudio(r.URL.Query().Get("id"))
		if err != nil || s.cover == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", s.cover.MIME)
		w.Write(s.cover.Data)
	})
}
