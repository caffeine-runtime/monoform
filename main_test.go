package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseLaunch(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "a.txt")
	os.WriteFile(f, []byte("x"), 0o644)
	files, mode := parseLaunch([]string{"--peek", "a.txt", "missing.txt", "-psn_0_1234"}, dir)
	if mode != "peek" || len(files) != 1 || files[0] != f {
		t.Errorf("peek: %v %q", files, mode)
	}
	if _, mode := parseLaunch([]string{"--preview", f}, "/"); mode != "preview" {
		t.Errorf("preview: %q", mode)
	}
	if files, mode := parseLaunch([]string{f}, "/"); mode != "" || len(files) != 1 {
		t.Errorf("plain: %v %q", files, mode)
	}
}
