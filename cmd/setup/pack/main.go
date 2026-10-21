// Command pack fills cmd/setup/payload with the app's files (gzipped) and
// files.json, before the setup program is built:
//
//	go run ./cmd/setup/pack build/bin/monoform.exe build/bin/monoform-cli.exe build/windows/file-*.ico
package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: pack FILE…")
		os.Exit(2)
	}
	out := filepath.Join("cmd", "setup", "payload")
	if err := os.MkdirAll(out, 0o755); err != nil {
		fail(err)
	}
	type entry struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
	}
	var list []entry
	for _, src := range os.Args[1:] {
		name := filepath.Base(src)
		n, err := pack(src, filepath.Join(out, name+".gz"))
		if err != nil {
			fail(err)
		}
		list = append(list, entry{name, n})
		fmt.Printf("%s: %d bytes\n", name, n)
	}
	data, _ := json.MarshalIndent(list, "", "  ")
	if err := os.WriteFile(filepath.Join(out, "files.json"), data, 0o644); err != nil {
		fail(err)
	}
}

func pack(src, dst string) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()
	f, err := os.Create(dst)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	z, _ := gzip.NewWriterLevel(f, gzip.BestCompression)
	n, err := io.Copy(z, in)
	if err != nil {
		return 0, err
	}
	return n, z.Close()
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
