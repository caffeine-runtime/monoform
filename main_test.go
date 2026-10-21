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

func TestParseNewWindow(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "a.txt")
	os.WriteFile(f, []byte("x"), 0o644)
	args := []string{"--new-window", "--at=120,-40", f}
	if files, mode := parseLaunch(args, "/"); mode != "window" || len(files) != 1 {
		t.Errorf("new window: %v %q", files, mode)
	}
	if x, y, ok := parseAt(args); !ok || x != 120 || y != -40 {
		t.Errorf("at: %d %d %v", x, y, ok)
	}
	if _, _, ok := parseAt([]string{"--at=nope"}); ok {
		t.Error("bad --at accepted")
	}
	if singleInstance("window", nil) != nil || singleInstance("", nil) == nil {
		t.Error("only a moved-out window runs without the single-instance lock")
	}
}
