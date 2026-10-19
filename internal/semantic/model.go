// Package semantic is the Go half of the optional "search by meaning"
// feature: it downloads the embedding model (only when the user asks), splits
// files into passages, and keeps a small vector index per folder. The model
// itself runs in a web worker (onnxruntime-web); Go never executes it.
package semantic

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// ModelFile is one file of the pinned model revision.
type ModelFile struct {
	Path   string
	Size   int64
	SHA256 string
}

// Model describes the embedding model: EmbeddingGemma 2 (Apache-2.0), text
// encoder only, 4-bit weights, from the onnx-community export pinned to one
// revision so the bytes we verify never change under us.
var Model = struct {
	ID       string
	Repo     string
	Revision string
	License  string
	Dims     int // stored dimensions (Matryoshka truncation of 768)
	Files    []ModelFile
}{
	ID:       "embeddinggemma-2-q4",
	Repo:     "onnx-community/embeddinggemma-2-ONNX",
	Revision: "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
	License:  "Apache-2.0",
	Dims:     256,
	Files: []ModelFile{
		{"tokenizer_config.json", 1599, "17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874"},
		{"tokenizer.json", 32170510, "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"},
		{"onnx/model_q4.onnx", 490742, "f9eeba97acddf139b8ee2ddf04bc30dceafa88de93fadf74d7644e0d61a477a9"},
		{"onnx/model_q4.onnx_data", 174028800, "c3975f2d1ab7a1878ae31a7d7a9b7804a827aff3800b60dfceafce21cac3df49"},
	},
}

// ModelBytes is the total download size.
func ModelBytes() int64 {
	var n int64
	for _, f := range Model.Files {
		n += f.Size
	}
	return n
}

// DefaultBaseURL is where the files are downloaded from.
func DefaultBaseURL() string {
	return "https://huggingface.co/" + Model.Repo + "/resolve/" + Model.Revision
}

// Installed reports whether every model file is present with the expected
// size (contents are verified when downloaded).
func Installed(dir string) bool {
	for _, f := range Model.Files {
		st, err := os.Stat(filepath.Join(dir, filepath.FromSlash(f.Path)))
		if err != nil || st.Size() != f.Size {
			return false
		}
	}
	return true
}

// Download fetches the model files into dir, verifying each SHA-256. Files
// already present with the right size are kept. Partial downloads are
// removed. progress receives bytes done/total.
func Download(ctx context.Context, dir, baseURL string, client *http.Client, progress func(done, total int64)) error {
	if client == nil {
		client = &http.Client{Timeout: 0}
	}
	total := ModelBytes()
	var done int64
	for _, f := range Model.Files {
		dst := filepath.Join(dir, filepath.FromSlash(f.Path))
		if st, err := os.Stat(dst); err == nil && st.Size() == f.Size {
			done += f.Size
			progress(done, total)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		base := done
		err := fetch(ctx, client, baseURL+"/"+f.Path, dst, f, func(n int64) { progress(base+n, total) })
		if err != nil {
			return err
		}
		done += f.Size
	}
	return nil
}

func fetch(ctx context.Context, client *http.Client, url, dst string, f ModelFile, progress func(int64)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: %s", f.Path, resp.Status)
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".part-*")
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	h := sha256.New()
	buf := make([]byte, 1<<20)
	var n int64
	last := time.Now()
	for {
		k, rerr := resp.Body.Read(buf)
		if k > 0 {
			if _, err := tmp.Write(buf[:k]); err != nil {
				return err
			}
			h.Write(buf[:k])
			n += int64(k)
			if n > f.Size {
				return fmt.Errorf("download %s: larger than expected", f.Path)
			}
			if time.Since(last) > 100*time.Millisecond {
				progress(n)
				last = time.Now()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if n != f.Size {
		return fmt.Errorf("download %s: got %d bytes, expected %d", f.Path, n, f.Size)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != f.SHA256 {
		return fmt.Errorf("download %s: checksum mismatch", f.Path)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), dst); err != nil {
		return err
	}
	ok = true
	progress(n)
	return nil
}

// Remove deletes the model directory.
func Remove(dir string) error {
	if dir == "" || !filepath.IsAbs(dir) {
		return errors.New("refusing to remove a relative model path")
	}
	return os.RemoveAll(dir)
}
