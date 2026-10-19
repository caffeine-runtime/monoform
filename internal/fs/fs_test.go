package fs

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAtomicWriteCreatesAndReplaces(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.txt")
	if err := AtomicWriteFile(p, []byte("one")); err != nil {
		t.Fatal(err)
	}
	if err := AtomicWriteFile(p, []byte("two\r\n")); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != "two\r\n" {
		t.Fatalf("content = %q", got)
	}
	assertNoTemps(t, dir)
}

func TestAtomicWriteRoundTripsBytes(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "bin")
	data := make([]byte, 1<<20)
	for i := range data {
		data[i] = byte(i * 7)
	}
	if err := AtomicWriteReader(p, strings.NewReader(string(data))); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != string(data) {
		t.Fatal("bytes differ")
	}
}

func TestAtomicWritePreservesPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix permissions")
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "script.sh")
	os.WriteFile(p, []byte("#!/bin/sh"), 0o750)
	os.Chmod(p, 0o750)
	if err := AtomicWriteFile(p, []byte("#!/bin/sh\necho hi")); err != nil {
		t.Fatal(err)
	}
	st, _ := os.Stat(p)
	if st.Mode().Perm() != 0o750 {
		t.Fatalf("mode = %v", st.Mode().Perm())
	}
}

func TestAtomicWriteFailureLeavesOriginal(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "keep.txt")
	os.WriteFile(p, []byte("original"), 0o644)
	boom := errors.New("boom")
	err := AtomicWrite(p, func(w io.Writer) error {
		w.Write([]byte("partial"))
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != "original" {
		t.Fatalf("original clobbered: %q", got)
	}
	assertNoTemps(t, dir)
}

func TestAtomicWriteThroughSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	dir := t.TempDir()
	real := filepath.Join(dir, "real.txt")
	link := filepath.Join(dir, "link.txt")
	os.WriteFile(real, []byte("a"), 0o644)
	if err := os.Symlink(real, link); err != nil {
		t.Skip(err)
	}
	if err := AtomicWriteFile(link, []byte("b")); err != nil {
		t.Fatal(err)
	}
	st, _ := os.Lstat(link)
	if st.Mode()&os.ModeSymlink == 0 {
		t.Fatal("link replaced by regular file")
	}
	got, _ := os.ReadFile(real)
	if string(got) != "b" {
		t.Fatalf("target = %q", got)
	}
}

func TestAtomicWriteRejectsDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := AtomicWriteFile(dir, []byte("x")); err == nil {
		t.Fatal("expected error writing over a directory")
	}
}

func assertNoTemps(t *testing.T, dir string) {
	t.Helper()
	des, _ := os.ReadDir(dir)
	for _, de := range des {
		if strings.HasSuffix(de.Name(), ".tmp") {
			t.Fatalf("leftover temp file %s", de.Name())
		}
	}
}

func TestListDirSortsAndSkips(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"img10.png", "img2.png", "B.txt", "a.md"} {
		os.WriteFile(filepath.Join(dir, n), nil, 0o644)
	}
	os.Mkdir(filepath.Join(dir, "zdir"), 0o755)
	os.Mkdir(filepath.Join(dir, ".git"), 0o755)
	os.Mkdir(filepath.Join(dir, "node_modules"), 0o755)
	es, err := ListDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range es {
		names = append(names, e.Name)
	}
	want := "zdir,a.md,B.txt,img2.png,img10.png"
	if strings.Join(names, ",") != want {
		t.Fatalf("got %v, want %s", names, want)
	}
	if es[1].Kind != "markdown" || es[3].Kind != "image" {
		t.Fatalf("kinds: %+v", es)
	}
}

func TestSiblings(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"c.jpg", "a.png", "notes.txt", "b.webp"} {
		os.WriteFile(filepath.Join(dir, n), nil, 0o644)
	}
	got, err := Siblings(filepath.Join(dir, "a.png"), []string{"image"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || filepath.Base(got[0]) != "a.png" || filepath.Base(got[2]) != "c.jpg" {
		t.Fatalf("siblings = %v", got)
	}
}

func TestNaturalLess(t *testing.T) {
	cases := [][2]string{{"a2", "a10"}, {"A", "b"}, {"file", "file1"}, {"x01", "x2"}}
	for _, c := range cases {
		if !NaturalLess(c[0], c[1]) || NaturalLess(c[1], c[0]) {
			t.Errorf("expected %q < %q", c[0], c[1])
		}
	}
}

type eventLog struct {
	mu sync.Mutex
	ev []ChangeEvent
}

func (l *eventLog) add(e ChangeEvent) { l.mu.Lock(); l.ev = append(l.ev, e); l.mu.Unlock() }
func (l *eventLog) snapshot() []ChangeEvent {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]ChangeEvent(nil), l.ev...)
}

func waitFor(t *testing.T, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func TestWatcherReportsExternalChange(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "w.txt")
	os.WriteFile(p, []byte("1"), 0o644)
	log := &eventLog{}
	w, err := NewWatcher(log.add)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if err := w.WatchFile(p); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(p, []byte("22"), 0o644)
	if !waitFor(t, func() bool { return len(log.snapshot()) > 0 }) {
		t.Fatal("no change event")
	}
	if ev := log.snapshot()[0]; ev.Path != p || ev.Dir {
		t.Fatalf("event = %+v", ev)
	}
}

func TestWatcherSuppressesOwnWrites(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "own.txt")
	os.WriteFile(p, []byte("1"), 0o644)
	log := &eventLog{}
	w, _ := NewWatcher(log.add)
	defer w.Close()
	w.WatchFile(p)
	AtomicWriteFile(p, []byte("mine"))
	w.NoteOwnWrite(p)
	time.Sleep(500 * time.Millisecond)
	if n := len(log.snapshot()); n != 0 {
		t.Fatalf("own write reported: %+v", log.snapshot())
	}
}

func TestWatcherDirListing(t *testing.T) {
	dir := t.TempDir()
	log := &eventLog{}
	w, _ := NewWatcher(log.add)
	defer w.Close()
	w.WatchDir(dir)
	os.WriteFile(filepath.Join(dir, "new.txt"), nil, 0o644)
	if !waitFor(t, func() bool { return len(log.snapshot()) > 0 }) {
		t.Fatal("no dir event")
	}
	if ev := log.snapshot()[0]; !ev.Dir || ev.Path != dir {
		t.Fatalf("event = %+v", ev)
	}
	w.UnwatchDir(dir)
}

func TestWalkFiles(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "a", "b"), 0o755)
	os.MkdirAll(filepath.Join(dir, ".git"), 0o755)
	os.MkdirAll(filepath.Join(dir, "node_modules", "x"), 0o755)
	os.WriteFile(filepath.Join(dir, "a", "b", "deep.txt"), nil, 0o644)
	os.WriteFile(filepath.Join(dir, "top.md"), nil, 0o644)
	os.WriteFile(filepath.Join(dir, ".git", "HEAD"), nil, 0o644)
	os.WriteFile(filepath.Join(dir, "node_modules", "x", "i.js"), nil, 0o644)
	got := WalkFiles(dir, 100)
	if len(got) != 2 {
		t.Fatalf("got %v", got)
	}
	if len(WalkFiles(dir, 1)) != 1 {
		t.Fatal("limit not applied")
	}
}

func TestAtomicFileChunks(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "chunked.txt")
	os.WriteFile(p, []byte("old"), 0o600)
	f, err := CreateAtomic(p)
	if err != nil {
		t.Fatal(err)
	}
	f.Write([]byte("part1-"))
	f.Write([]byte("part2"))
	if got, _ := os.ReadFile(p); string(got) != "old" {
		t.Fatal("target changed before commit")
	}
	if err := f.Commit(); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(p); string(got) != "part1-part2" {
		t.Fatalf("got %q", got)
	}
	if err := f.Commit(); err == nil {
		t.Fatal("double commit allowed")
	}
	g, _ := CreateAtomic(p)
	g.Write([]byte("never"))
	g.Abort()
	if got, _ := os.ReadFile(p); string(got) != "part1-part2" {
		t.Fatal("abort changed target")
	}
	assertNoTemps(t, dir)
}
