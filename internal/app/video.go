package app

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/caffeine-runtime/hold-it-all/internal/jobs"
	"github.com/caffeine-runtime/hold-it-all/internal/video"
)

// VideoOpened is what the video module needs to show a file.
type VideoOpened struct {
	Info *video.Info `json:"info"`
	URL  string      `json:"url"`
}

// VideoOpen probes a video file and registers it with the media server.
func (a *App) VideoOpen(path string) (*VideoOpened, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("absolute path required")
	}
	info, err := video.Probe(path)
	if err != nil {
		return nil, err
	}
	url, err := a.media().Register(path)
	if err != nil {
		return nil, err
	}
	return &VideoOpened{Info: info, URL: url}, nil
}

// VideoExport writes the plan for src into dest without re-encoding, as a
// background job (result: the kept ranges after snapping to keyframes).
func (a *App) VideoExport(src string, plan video.Plan, dest string) (string, error) {
	if !filepath.IsAbs(src) || !filepath.IsAbs(dest) {
		return "", errors.New("absolute paths required")
	}
	return a.Jobs.Start("video-export", "Saving "+filepath.Base(dest), func(ctx context.Context, r *jobs.Reporter) (any, error) {
		if a.watcher != nil {
			a.watcher.NoteOwnWrite(dest)
		}
		kept, err := video.Export(ctx, src, plan, dest, func(done, total int64) { r.Set(done, total, "") })
		if a.watcher != nil {
			a.watcher.NoteOwnWrite(dest)
		}
		return kept, err
	}), nil
}

// VideoDemux lists a video's streams and sample locations so the webview can
// decode it with WebCodecs (rendering effects). Sample bytes are read from the
// media server URL returned by VideoOpen.
func (a *App) VideoDemux(path string) (*video.Demux, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("absolute path required")
	}
	return video.DemuxFile(path)
}
