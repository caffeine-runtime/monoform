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
	if files, mode := parseLaunch([]string{"--convert", f, f}, "/"); mode != "convert" || len(files) != 2 {
		t.Errorf("convert: %v %q", files, mode)
	}
	if l := singleInstance("convert", nil); l == nil || l.UniqueId == "dev.monoform.app" {
		t.Error("convert windows gather files in their own instance, apart from the editor")
	}
	if _, _, ok := parseAt([]string{"--at=nope"}); ok {
		t.Error("bad --at accepted")
	}
	if singleInstance("window", nil) != nil || singleInstance("peek", nil) != nil || singleInstance("", nil) == nil || singleInstance("preview", nil) == nil {
		t.Error("only a moved-out window and quick peeks run without the single-instance lock")
	}
}

func TestPeekSize(t *testing.T) {
	if w, h := peekSize([]string{"/m/song.MP3"}); w != 720 || h != 420 {
		t.Errorf("audio: %d×%d", w, h)
	}
	for _, files := range [][]string{{"/m/a.png"}, {"/m/song.mp3", "/m/clip.mp4"}, nil} {
		if w, h := peekSize(files); w != 960 || h != 680 {
			t.Errorf("%v: %d×%d", files, w, h)
		}
	}
}
