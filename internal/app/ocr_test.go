package app

import (
	"compress/gzip"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestOcrLanguages(t *testing.T) {
	t.Setenv("MF_CACHE", t.TempDir())
	a := &App{Assets: fstest.MapFS{"tesseract/tessdata/eng.traineddata.gz": {Data: []byte("\x1f\x8bbundled")}}}
	if got := a.OcrLanguages(); len(got) != 1 || got[0].Code != "eng" || !got[0].Bundled {
		t.Fatalf("bundled: %+v", got)
	}
	src := filepath.Join(t.TempDir(), "pol.traineddata")
	os.WriteFile(src, []byte(strings.Repeat("x", 2048)), 0o644)
	code, err := a.OcrAddLanguage(src)
	if err != nil || code != "pol" {
		t.Fatalf("add: %q %v", code, err)
	}
	langs := a.OcrLanguages()
	if len(langs) != 2 || langs[1].Name != "Polish" || langs[1].Bundled {
		t.Fatalf("after add: %+v", langs)
	}
	// Served gzipped; the bundled one from the app's assets.
	rec := httptest.NewRecorder()
	a.serveTessdata(rec, httptest.NewRequest("GET", "/__mf/tessdata?f=/pol.traineddata.gz", nil))
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := io.ReadAll(zr); len(b) != 2048 {
		t.Errorf("served %d bytes", len(b))
	}
	rec = httptest.NewRecorder()
	a.serveTessdata(rec, httptest.NewRequest("GET", "/__mf/tessdata?f=/eng.traineddata.gz", nil))
	if rec.Body.String() != "\x1f\x8bbundled" {
		t.Errorf("bundled served: %q", rec.Body.String())
	}
	for _, bad := range []string{"/../x.traineddata.gz", "/deu.traineddata.gz", "/eng.txt"} {
		rec = httptest.NewRecorder()
		a.serveTessdata(rec, httptest.NewRequest("GET", "/__mf/tessdata?f="+bad, nil))
		if rec.Code < 400 {
			t.Errorf("%s served", bad)
		}
	}
	if err := a.OcrRemoveLanguage("eng"); err == nil {
		t.Error("bundled language removed")
	}
	if err := a.OcrRemoveLanguage("pol"); err != nil || len(a.OcrLanguages()) != 1 {
		t.Errorf("remove: %v", err)
	}
	if _, err := a.OcrAddLanguage(filepath.Join(t.TempDir(), "notes.txt")); err == nil {
		t.Error("non-language file accepted")
	}
}
