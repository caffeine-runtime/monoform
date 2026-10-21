package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/caffeine-runtime/hold-it-all/internal/ai"
	"github.com/caffeine-runtime/hold-it-all/internal/jobs"
	"github.com/caffeine-runtime/hold-it-all/internal/server"
)

// Optional image models (better subject selection, object removal). They are
// downloaded only when the user installs them (Settings › AI models, or the
// offer when first used) into the cache dir and run in-process with ONNX
// Runtime, loaded on use and freed after a minute idle. HIA_AI_FAKE=1 (self
// tests) swaps them for tiny stand-ins: installing takes a moment, the
// subject is an ellipse and removal fills with the surrounding colour.

var (
	aiOnce   sync.Once
	aiEngine *ai.Engine
)

func (a *App) ai() *ai.Engine {
	aiOnce.Do(func() {
		aiEngine = &ai.Engine{Store: ai.Store{Dir: filepath.Join(cacheDir(), "models")}, IdleAfter: time.Minute}
	})
	return aiEngine
}

func aiFake() bool { return os.Getenv("HIA_AI_FAKE") == "1" && os.Getenv("HIA_TEST") != "" }

func fakeInstalled(p ai.Pack) string { return filepath.Join(cacheDir(), "models", "fake-"+p.ID) }

// AIPack describes an optional model for Settings.
type AIPack struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Purpose   string `json:"purpose"`
	Model     string `json:"model"`
	License   string `json:"license"`
	Source    string `json:"source"`
	Installed bool   `json:"installed"`
	Supported bool   `json:"supported"`
	// Download is what installing transfers now (with the runtime if it's
	// missing); Disk is the space it takes once installed.
	Download int64 `json:"download"`
	Disk     int64 `json:"disk"`
}

// AIPacks lists the optional models and whether each is installed.
func (a *App) AIPacks() []AIPack {
	e := a.ai()
	var out []AIPack
	for _, p := range ai.Packs {
		info := AIPack{
			ID: p.ID, Name: p.Name, Purpose: p.Purpose, Model: p.Model, License: p.License, Source: p.Source,
			Installed: e.Store.Installed(p), Supported: ai.Supported(),
			Download: e.Store.DownloadBytes(p), Disk: p.DiskBytes(),
		}
		if !e.Store.RuntimeInstalled() {
			info.Disk += ai.RuntimeDiskBytes()
		}
		if aiFake() {
			_, err := os.Stat(fakeInstalled(p))
			info.Installed, info.Supported = err == nil, true
			if info.Installed {
				info.Download = 0
			}
		}
		out = append(out, info)
	}
	return out
}

// AIInstall downloads a pack (only after the user agreed; the app's only
// network access besides the search model). Returns the job id.
func (a *App) AIInstall(id string) (string, error) {
	p, ok := ai.PackByID(id)
	if !ok {
		return "", fmt.Errorf("unknown model %q", id)
	}
	return a.Jobs.Start("ai-install", "Downloading "+p.Name, func(ctx context.Context, r *jobs.Reporter) (any, error) {
		if aiFake() {
			for i := int64(1); i <= 10; i++ {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(40 * time.Millisecond):
				}
				r.Set(i, 10, "")
			}
			if err := os.MkdirAll(filepath.Dir(fakeInstalled(p)), 0o755); err != nil {
				return nil, err
			}
			return nil, os.WriteFile(fakeInstalled(p), nil, 0o644)
		}
		return nil, a.ai().Store.Install(ctx, nil, p, func(done, total int64) { r.Set(done, total, "") })
	}), nil
}

// AIRemove deletes a pack (and the runtime when nothing else needs it).
func (a *App) AIRemove(id string) error {
	p, ok := ai.PackByID(id)
	if !ok {
		return fmt.Errorf("unknown model %q", id)
	}
	if aiFake() {
		return os.RemoveAll(fakeInstalled(p))
	}
	e := a.ai()
	e.Unload()
	return e.Store.Remove(p)
}

// Inputs and results travel in pieces (≤ 256 KB per request): WebKitGTK and
// WebView2 handle the app's own requests on the UI thread, so a 3 MB body in
// one request freezes a frame for ~80 ms. Inputs are assembled here by id;
// results wait (2 minutes at most) until fetched with Range requests.
type aiBlob struct {
	data    []byte
	expires *time.Timer
}

var aiBlobs = struct {
	sync.Mutex
	in, out map[string]*aiBlob
}{in: map[string]*aiBlob{}, out: map[string]*aiBlob{}}

func keepBlob(m map[string]*aiBlob, id string, data []byte) {
	if old := m[id]; old != nil {
		old.expires.Stop()
	}
	b := &aiBlob{data: data}
	b.expires = time.AfterFunc(2*time.Minute, func() {
		aiBlobs.Lock()
		if m[id] == b {
			delete(m, id)
		}
		aiBlobs.Unlock()
	})
	m[id] = b
}

// takeInput returns an assembled input of the expected size (and forgets it).
func takeInput(id string, size int) ([]byte, error) {
	aiBlobs.Lock()
	defer aiBlobs.Unlock()
	b := aiBlobs.in[id]
	if b == nil || len(b.data) != size {
		return nil, errors.New("incomplete input")
	}
	b.expires.Stop()
	delete(aiBlobs.in, id)
	return b.data, nil
}

func (a *App) registerAIRoutes() {
	// A piece of an input: ?id=&off=&total= (the first piece allocates it).
	a.Server.Handle("POST /__hia/ai/input", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		id := q.Get("id")
		off, err1 := strconv.Atoi(q.Get("off"))
		total, err2 := strconv.Atoi(q.Get("total"))
		if id == "" || err1 != nil || err2 != nil || total <= 0 || total > 8<<20 || off < 0 || off >= total {
			server.Error(w, http.StatusBadRequest, errors.New("bad input piece"))
			return
		}
		piece, err := io.ReadAll(io.LimitReader(r.Body, int64(total-off)+1))
		if err != nil || off+len(piece) > total {
			server.Error(w, http.StatusBadRequest, errors.New("bad input piece"))
			return
		}
		aiBlobs.Lock()
		b := aiBlobs.in[id]
		if b == nil || len(b.data) != total {
			keepBlob(aiBlobs.in, id, make([]byte, total))
			b = aiBlobs.in[id]
		}
		copy(b.data[off:], piece)
		aiBlobs.Unlock()
		server.JSON(w, map[string]bool{"ok": true})
	})
	// A result, by Range (it's dropped once its last byte was read).
	a.Server.Handle("GET /__hia/ai/result", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		aiBlobs.Lock()
		b := aiBlobs.out[id]
		aiBlobs.Unlock()
		if b == nil {
			server.Error(w, http.StatusNotFound, errors.New("no such result"))
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(b.data))
		if rng := r.Header.Get("Range"); rng == "" || strings.HasSuffix(rng, fmt.Sprintf("-%d", len(b.data)-1)) {
			aiBlobs.Lock()
			if aiBlobs.out[id] == b {
				b.expires.Stop()
				delete(aiBlobs.out, id)
			}
			aiBlobs.Unlock()
		}
	})
	// The subject of a picture: the input is SubjectSize² RGB; the result one
	// opacity byte per pixel. Replies {"result": id}.
	a.Server.Handle("POST /__hia/ai/subject", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("input")
		rgb, err := takeInput(id, 3*ai.SubjectSize*ai.SubjectSize)
		if err != nil {
			server.Error(w, http.StatusBadRequest, err)
			return
		}
		var mask []byte
		if aiFake() {
			mask, err = fakeSubject(rgb)
		} else {
			mask, err = a.ai().SubjectMask(r.Context(), rgb)
		}
		if err != nil {
			server.Error(w, aiStatus(err), err)
			return
		}
		aiBlobs.Lock()
		keepBlob(aiBlobs.out, id, mask)
		aiBlobs.Unlock()
		server.JSON(w, map[string]string{"result": id})
	})
	// Object removal runs as a job (progress and Cancel in the status bar):
	// the input is EraseSize² RGB then EraseSize² mask bytes. Replies the job
	// id; the repainted RGB is the result under that id once the job is done.
	a.Server.Handle("POST /__hia/ai/erase", func(w http.ResponseWriter, r *http.Request) {
		const n = ai.EraseSize * ai.EraseSize
		body, err := takeInput(r.URL.Query().Get("input"), 4*n)
		if err != nil {
			server.Error(w, http.StatusBadRequest, err)
			return
		}
		seed, _ := strconv.ParseUint(r.URL.Query().Get("seed"), 10, 64)
		rgb, mask := body[:3*n], body[3*n:]
		id := a.Jobs.Start("ai-erase", "Removing the object", func(ctx context.Context, rep *jobs.Reporter) (any, error) {
			var out []byte
			var err error
			if aiFake() {
				out, err = fakeErase(rgb, mask)
			} else {
				out, err = a.ai().Erase(ctx, rgb, mask, seed, func(done, total int) { rep.Set(int64(done), int64(total), "") })
			}
			if err != nil {
				return nil, err
			}
			aiBlobs.Lock()
			keepBlob(aiBlobs.out, rep.ID(), out)
			aiBlobs.Unlock()
			return nil, nil
		})
		server.JSON(w, map[string]string{"id": id})
	})
}

func aiStatus(err error) int {
	switch {
	case errors.Is(err, ai.ErrNotInstalled):
		return http.StatusPreconditionFailed
	case errors.Is(err, context.Canceled):
		return http.StatusRequestTimeout
	}
	return http.StatusInternalServerError
}

// fakeSubject is an ellipse in the middle (self tests without the model).
func fakeSubject(rgb []byte) ([]byte, error) {
	const s = ai.SubjectSize
	if len(rgb) != 3*s*s {
		return nil, errors.New("bad size")
	}
	m := make([]byte, s*s)
	for y := 0; y < s; y++ {
		for x := 0; x < s; x++ {
			dx, dy := float64(x-s/2)/(s*0.3), float64(y-s/2)/(s*0.35)
			if dx*dx+dy*dy <= 1 {
				m[y*s+x] = 255
			}
		}
	}
	return m, nil
}

// fakeErase fills the mask with the mean colour around it.
func fakeErase(rgb, mask []byte) ([]byte, error) {
	var sum [3]int
	n := 0
	for i, m := range mask {
		if m < 128 {
			for c := 0; c < 3; c++ {
				sum[c] += int(rgb[3*i+c])
			}
			n++
		}
	}
	out := append([]byte(nil), rgb...)
	for i, m := range mask {
		if m >= 128 {
			for c := 0; c < 3; c++ {
				out[3*i+c] = byte(sum[c] / max(1, n))
			}
		}
	}
	time.Sleep(400 * time.Millisecond) // long enough to show progress
	return out, nil
}
