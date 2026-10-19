package app

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sync"

	"github.com/caffeine-runtime/hold-it-all/internal/jobs"
	"github.com/caffeine-runtime/hold-it-all/internal/semantic"
	"github.com/caffeine-runtime/hold-it-all/internal/server"
)

// Optional semantic search. The model is downloaded only on request into the
// user cache dir; the index of each folder lives next to it. HIA_CACHE moves
// both (tests), HIA_MODEL_DIR points at an existing model copy and
// HIA_MODEL_URL replaces the download host (tests).

var (
	semOnce  sync.Once
	semStore *semantic.Store
)

func cacheDir() string {
	if d := os.Getenv("HIA_CACHE"); d != "" {
		return d
	}
	d, err := os.UserCacheDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "HoldItAll")
}

func modelDir() string {
	if d := os.Getenv("HIA_MODEL_DIR"); d != "" {
		return d
	}
	return filepath.Join(cacheDir(), "models", semantic.Model.ID)
}

func (a *App) sem() *semantic.Store {
	semOnce.Do(func() { semStore = semantic.NewStore(filepath.Join(cacheDir(), "index")) })
	return semStore
}

type SemanticInfo struct {
	Installed  bool   `json:"installed"`
	ModelID    string `json:"modelId"`
	Repo       string `json:"repo"`
	Revision   string `json:"revision"`
	License    string `json:"license"`
	ModelBytes int64  `json:"modelBytes"`
	Dims       int    `json:"dims"`
	ModelDir   string `json:"modelDir"`
}

// SemanticInfo describes the embedding model and whether it is downloaded.
func (a *App) SemanticInfo() SemanticInfo {
	m := semantic.Model
	return SemanticInfo{
		Installed: semantic.Installed(modelDir()), ModelID: m.ID, Repo: m.Repo, Revision: m.Revision,
		License: m.License, ModelBytes: semantic.ModelBytes(), Dims: m.Dims, ModelDir: modelDir(),
	}
}

// SemanticDownload starts downloading the model (the only network access in
// the app, and only after the user agreed to it).
func (a *App) SemanticDownload() string {
	base := semantic.DefaultBaseURL()
	if u := os.Getenv("HIA_MODEL_URL"); u != "" {
		base = u
	}
	return a.Jobs.Start("model", "Downloading search model", func(ctx context.Context, r *jobs.Reporter) (any, error) {
		return nil, semantic.Download(ctx, modelDir(), base, nil, func(done, total int64) { r.Set(done, total, "") })
	})
}

// SemanticRemoveModel deletes the downloaded model and all folder indexes.
func (a *App) SemanticRemoveModel() error {
	if os.Getenv("HIA_MODEL_DIR") != "" {
		return errors.New("the model directory is set by HIA_MODEL_DIR; not removing it")
	}
	if err := a.sem().ClearAll(); err != nil {
		return err
	}
	return semantic.Remove(modelDir())
}

// SemanticPending lists the files of root that need embedding.
func (a *App) SemanticPending(root string) semantic.Pending { return a.sem().Pending(root) }

type PassagesResult struct {
	Size     int64              `json:"size"`
	Mod      int64              `json:"mod"`
	Passages []semantic.Passage `json:"passages"`
}

// SemanticPassages reads a file and splits it into passages to embed.
func (a *App) SemanticPassages(p string) (PassagesResult, error) {
	size, mod, ps, err := semantic.ReadPassages(p)
	return PassagesResult{Size: size, Mod: mod, Passages: ps}, err
}

// SemanticPut stores the embedded passages of one file; mode is "all",
// "first" or "rest" (two-pass indexing).
func (a *App) SemanticPut(root, p string, size, mod int64, items []semantic.Item, mode string) error {
	return a.sem().Put(root, p, size, mod, items, mode)
}

// SemanticQuery returns the k best files for an embedded query.
func (a *App) SemanticQuery(root string, vec []float32, k int) ([]semantic.Hit, error) {
	return a.sem().Query(root, vec, k)
}

// SemanticStatus reports the index size of root.
func (a *App) SemanticStatus(root string) semantic.Status { return a.sem().Status(root) }

// SemanticClearIndex deletes every folder index (the model stays).
func (a *App) SemanticClearIndex() error { return a.sem().ClearAll() }

// SemanticUnload saves the index and frees its memory.
func (a *App) SemanticUnload() { a.sem().Unload() }

// registerModelRoute serves the model files to the embedding worker.
func (a *App) registerModelRoute() {
	allowed := map[string]bool{}
	for _, f := range semantic.Model.Files {
		allowed[f.Path] = true
	}
	a.Server.Handle("GET /__hia/model/{file...}", func(w http.ResponseWriter, r *http.Request) {
		name := path.Clean(r.PathValue("file"))
		if !allowed[name] {
			server.Error(w, http.StatusNotFound, errors.New("not a model file"))
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		http.ServeFile(w, r, filepath.Join(modelDir(), filepath.FromSlash(name)))
	})
}

func (a *App) flushSemantic() {
	if semStore != nil {
		semStore.Flush()
	}
}
