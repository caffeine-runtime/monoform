package app

import (
	"io"
	"net/url"
	"strconv"

	"github.com/caffeine-runtime/hold-it-all/internal/imaging"
)

// registerRoutes adds module-specific routes and save transforms to the data channel.
func (a *App) registerRoutes() {
	// Images are uploaded as PNG and re-encoded to ?format= (quality via ?quality=).
	a.Server.Transforms["image"] = func(w io.Writer, r io.Reader, q url.Values) error {
		quality, _ := strconv.Atoi(q.Get("quality"))
		return imaging.Transcode(w, r, imaging.Options{Format: q.Get("format"), Quality: quality})
	}
}
