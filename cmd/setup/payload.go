package main

import (
	"compress/gzip"
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"strings"

	"github.com/caffeine-runtime/hold-it-all/internal/setup"
)

// The app's files, gzipped, with payload/files.json listing names and sizes
// (scripts/build-setup.sh writes both).
//
//go:embed all:payload
var payloadFS embed.FS

type payloadEntry struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// payloadFiles returns the embedded files; with none embedded (a demo
// build) it makes small stand-ins so the demo can run.
func payloadFiles() []setup.File {
	data, err := payloadFS.ReadFile("payload/files.json")
	var list []payloadEntry
	if err == nil {
		_ = json.Unmarshal(data, &list)
	}
	var out []setup.File
	for _, e := range list {
		e := e
		out = append(out, setup.File{Name: e.Name, Size: e.Size, Open: func() (io.ReadCloser, error) {
			f, err := payloadFS.Open("payload/" + e.Name + ".gz")
			if err != nil {
				return nil, err
			}
			z, err := gzip.NewReader(f)
			if err != nil {
				f.Close()
				return nil, err
			}
			return struct {
				io.Reader
				io.Closer
			}{z, closers{z, f}}, nil
		}})
	}
	if len(out) == 0 {
		for _, n := range []string{setup.Exe, "holdit.exe", "fileicon.ico"} {
			n := n
			body := "stand-in for " + n + " (demo build without a payload)\n"
			out = append(out, setup.File{Name: n, Size: int64(len(body)), Open: func() (io.ReadCloser, error) { return io.NopCloser(strings.NewReader(body)), nil }})
		}
	}
	return out
}

type closers []io.Closer

func (c closers) Close() error {
	var first error
	for _, x := range c {
		if err := x.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

var _ fs.FS = payloadFS
