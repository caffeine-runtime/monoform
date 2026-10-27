package app

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/caffeine-runtime/monoform/internal/video"
)

func TestRecordingName(t *testing.T) {
	at := time.Date(2026, 10, 27, 9, 5, 3, 0, time.Local)
	if got := recordingName(at, "mp4"); got != "Screen recording 2026-10-27 at 09.05.03.mp4" {
		t.Fatal(got)
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "a.mp4")
	if freePath(p) != p {
		t.Fatal("a free name is kept")
	}
	os.WriteFile(p, nil, 0o644)
	os.WriteFile(filepath.Join(dir, "a (2).mp4"), nil, 0o644)
	if got := freePath(p); got != filepath.Join(dir, "a (3).mp4") {
		t.Fatal(got)
	}
}

// record streams a fixture into a new recording the way the recorder does
// (in pieces) and returns the finished file.
func record(t *testing.T, a *App, ext string, data []byte) (string, string, error) {
	t.Helper()
	dest, err := a.RecordBegin(ext)
	if err != nil {
		t.Fatal(err)
	}
	part := rec.part
	for len(data) > 0 {
		n := min(len(data), 7000)
		if _, err := rec.appendChunk(bytes.NewReader(data[:n])); err != nil {
			t.Fatal(err)
		}
		data = data[n:]
	}
	got, err := a.RecordFinish()
	if got != "" && got != dest {
		t.Fatalf("finished as %s, announced %s", got, dest)
	}
	return got, part, err
}

func TestRecordFinish(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MF_RECORDINGS", filepath.Join(dir, "Screen Recordings"))
	a := &App{}
	for _, ext := range []string{"mp4", "webm"} {
		data, err := os.ReadFile(filepath.Join("..", "video", "testdata", "recorded."+ext))
		if err != nil {
			t.Fatal(err)
		}
		got, part, err := record(t, a, ext, data)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(filepath.Base(got), "Screen recording ") || filepath.Ext(got) != "."+ext || filepath.Dir(got) != filepath.Join(dir, "Screen Recordings") {
			t.Fatalf("saved as %s", got)
		}
		if !strings.HasPrefix(filepath.Base(part), ".") || filepath.Dir(part) != filepath.Dir(got) {
			t.Fatalf("written to %s while recording", part)
		}
		if _, err := os.Stat(part); !os.IsNotExist(err) {
			t.Fatalf("the pieces are left behind: %v", err)
		}
		info, err := video.Probe(got)
		if err != nil || !info.Editable || info.Duration < 1 {
			t.Fatalf("%s: %+v %v", ext, info, err)
		}
	}
	// Two in the same second get different names.
	data, _ := os.ReadFile(filepath.Join("..", "video", "testdata", "recorded.mp4"))
	first, _, _ := record(t, a, "mp4", data)
	second, _, _ := record(t, a, "mp4", data)
	if first == second {
		t.Fatal("a recording replaced another")
	}
}

func TestRecordKeepsWhatCantBeFinished(t *testing.T) {
	t.Setenv("MF_RECORDINGS", t.TempDir())
	a := &App{}
	got, part, err := record(t, a, "mp4", []byte("not a video, but someone's recording"))
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(got); string(b) != "not a video, but someone's recording" {
		t.Fatalf("kept %q", b)
	}
	if _, err := os.Stat(part); !os.IsNotExist(err) {
		t.Fatal("the pieces are left behind")
	}
}

func TestRecordDiscardAndMisuse(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MF_RECORDINGS", dir)
	a := &App{}
	if _, err := a.RecordBegin("avi"); err == nil {
		t.Fatal("only mp4 and webm")
	}
	if _, err := a.RecordFinish(); err == nil {
		t.Fatal("finishing without a recording")
	}
	if _, err := a.RecordBegin("webm"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.RecordBegin("webm"); err == nil {
		t.Fatal("two recordings at once")
	}
	rec.appendChunk(strings.NewReader("abc"))
	if err := a.RecordDiscard(); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("discarding left %v", entries)
	}
	if _, err := rec.appendChunk(strings.NewReader("late")); err == nil {
		t.Fatal("a piece after the end")
	}
	// Stopping before anything was recorded leaves nothing either.
	a.RecordBegin("mp4")
	if _, err := a.RecordFinish(); err == nil {
		t.Fatal("an empty recording")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("an empty recording left %v", entries)
	}
}
