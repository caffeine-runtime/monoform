package app

// Text recognition (OCR) runs in the webview (Tesseract compiled to WASM).
// Go serves its language data — the bundled English model and any
// .traineddata files the user adds (never downloaded) — and adds recognised
// text to PDFs as an invisible, searchable layer.

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	iofs "io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/caffeine-runtime/monoform/internal/pdf"
	"github.com/caffeine-runtime/monoform/internal/server"
)

// OcrLanguage is one language the recogniser can use.
type OcrLanguage struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	Bundled bool   `json:"bundled"`
}

var ocrNames = map[string]string{
	"eng": "English", "deu": "German", "fra": "French", "spa": "Spanish", "ita": "Italian", "por": "Portuguese",
	"nld": "Dutch", "pol": "Polish", "ces": "Czech", "slk": "Slovak", "hun": "Hungarian", "ron": "Romanian",
	"swe": "Swedish", "nor": "Norwegian", "dan": "Danish", "fin": "Finnish", "est": "Estonian", "lav": "Latvian",
	"lit": "Lithuanian", "slv": "Slovenian", "hrv": "Croatian", "srp": "Serbian", "bul": "Bulgarian", "ukr": "Ukrainian",
	"rus": "Russian", "ell": "Greek", "tur": "Turkish", "heb": "Hebrew", "ara": "Arabic", "fas": "Persian",
	"hin": "Hindi", "ben": "Bengali", "tha": "Thai", "vie": "Vietnamese", "ind": "Indonesian", "msa": "Malay",
	"jpn": "Japanese", "kor": "Korean", "chi_sim": "Chinese (simplified)", "chi_tra": "Chinese (traditional)",
	"cat": "Catalan", "eus": "Basque", "glg": "Galician", "isl": "Icelandic", "gle": "Irish", "cym": "Welsh",
	"lat": "Latin", "osd": "Orientation and script",
}

var reLangCode = regexp.MustCompile(`^[a-z][a-z0-9_]{1,15}$`)

func ocrDir() string { return filepath.Join(cacheDir(), "tessdata") }

// OcrLanguages lists the bundled and the added languages.
func (a *App) OcrLanguages() []OcrLanguage {
	seen := map[string]bool{}
	var out []OcrLanguage
	if a.Assets != nil {
		if es, err := iofs.ReadDir(a.Assets, "tesseract/tessdata"); err == nil {
			for _, e := range es {
				if code, ok := strings.CutSuffix(e.Name(), ".traineddata.gz"); ok && !seen[code] {
					seen[code] = true
					out = append(out, OcrLanguage{Code: code, Name: ocrName(code), Bundled: true})
				}
			}
		}
	}
	if es, err := os.ReadDir(ocrDir()); err == nil {
		for _, e := range es {
			if code, ok := strings.CutSuffix(e.Name(), ".traineddata.gz"); ok && !seen[code] {
				seen[code] = true
				out = append(out, OcrLanguage{Code: code, Name: ocrName(code)})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func ocrName(code string) string {
	if n, ok := ocrNames[code]; ok {
		return n
	}
	return code
}

// OcrAddLanguage copies a Tesseract .traineddata(.gz) file into the app's
// data and returns its language code.
func (a *App) OcrAddLanguage(path string) (string, error) {
	base := filepath.Base(path)
	code := strings.TrimSuffix(strings.TrimSuffix(base, ".gz"), ".traineddata")
	if code == base || !reLangCode.MatchString(code) {
		return "", errors.New("choose a Tesseract language file such as pol.traineddata")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	gz := len(b) > 2 && b[0] == 0x1f && b[1] == 0x8b
	if !gz && len(b) < 1024 {
		return "", errors.New("this doesn't look like a Tesseract language file")
	}
	if err := os.MkdirAll(ocrDir(), 0o755); err != nil {
		return "", err
	}
	if !gz {
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
		zw.Write(b)
		zw.Close()
		b = buf.Bytes()
	}
	if err := os.WriteFile(filepath.Join(ocrDir(), code+".traineddata.gz"), b, 0o644); err != nil {
		return "", err
	}
	return code, nil
}

// OcrRemoveLanguage deletes an added language (bundled ones stay).
func (a *App) OcrRemoveLanguage(code string) error {
	if !reLangCode.MatchString(code) {
		return errors.New("bad language code")
	}
	err := os.Remove(filepath.Join(ocrDir(), code+".traineddata.gz"))
	if errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("%s is bundled and can't be removed", ocrName(code))
	}
	return err
}

func (a *App) serveTessdata(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(strings.TrimPrefix(r.URL.Query().Get("f"), "/"))
	code, ok := strings.CutSuffix(name, ".traineddata.gz")
	if !ok || !reLangCode.MatchString(code) {
		server.Error(w, http.StatusBadRequest, errors.New("bad language file"))
		return
	}
	var rc io.ReadCloser
	if f, err := os.Open(filepath.Join(ocrDir(), name)); err == nil {
		rc = f
	} else if a.Assets != nil {
		if f, err := a.Assets.Open("tesseract/tessdata/" + name); err == nil {
			rc = f
		}
	}
	if rc == nil {
		server.Error(w, http.StatusNotFound, fmt.Errorf("no %s language data", ocrName(code)))
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "application/gzip")
	io.Copy(w, rc)
}

// OcrPage is the text-only PDF Tesseract made for one page.
type OcrPage struct {
	Page int    `json:"page"`
	PDF  []byte `json:"pdf"`
}

// PdfAddTextLayer lays recognised text over pages of src; returns a temp
// working copy.
func (a *App) PdfAddTextLayer(src string, pages []OcrPage) (string, error) {
	layers := map[int][]byte{}
	for _, p := range pages {
		layers[p.Page] = p.PDF
	}
	dst := a.TempPath("searchable.pdf")
	if err := pdf.AddTextLayer(context.Background(), src, dst, layers); err != nil {
		os.Remove(dst)
		return "", err
	}
	return dst, nil
}
