package app

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"

	"github.com/caffeine-runtime/hold-it-all/internal/archive"
	"github.com/caffeine-runtime/hold-it-all/internal/imaging"
	"github.com/caffeine-runtime/hold-it-all/internal/office"
	"github.com/caffeine-runtime/hold-it-all/internal/server"
)

// registerRoutes adds module-specific routes and save transforms to the data channel.
func (a *App) registerRoutes() {
	// Images are uploaded as PNG and re-encoded to ?format= (quality via ?quality=).
	a.Server.Transforms["image"] = func(w io.Writer, r io.Reader, q url.Values) error {
		quality, _ := strconv.Atoi(q.Get("quality"))
		return imaging.Transcode(w, r, imaging.Options{Format: q.Get("format"), Quality: quality})
	}
	// One file inside an archive, streamed to the viewer (read-only tabs).
	a.Server.Handle("GET /__hia/archive/entry", func(w http.ResponseWriter, r *http.Request) {
		p, entry := r.URL.Query().Get("archive"), r.URL.Query().Get("entry")
		if !filepath.IsAbs(p) || entry == "" {
			server.Error(w, http.StatusBadRequest, errors.New("archive and entry required"))
			return
		}
		w.Header().Set("Content-Type", server.ContentType(entry))
		// Stream directly; an error after the first byte can only abort.
		if err := archive.ReadEntry(r.Context(), p, entry, w, 2<<30); err != nil {
			server.Error(w, server.StatusFor(err), err)
		}
	})
	// OCR language data: ?f=/<lang>.traineddata.gz (the worker appends the file name).
	a.Server.Handle("GET /__hia/tessdata", a.serveTessdata)
	// One part of a zip-based document (images inside .docx).
	a.Server.Handle("GET /__hia/zip", func(w http.ResponseWriter, r *http.Request) {
		p, entry := r.URL.Query().Get("path"), r.URL.Query().Get("entry")
		if !filepath.IsAbs(p) || entry == "" {
			server.Error(w, http.StatusBadRequest, errors.New("path and entry required"))
			return
		}
		b, err := office.ReadZipEntry(p, entry, 64<<20)
		if err != nil {
			server.Error(w, server.StatusFor(err), err)
			return
		}
		w.Header().Set("Content-Type", server.ContentType(entry))
		w.Write(b)
	})
}
