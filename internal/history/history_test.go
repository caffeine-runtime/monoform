package history

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	hfs "github.com/caffeine-runtime/hold-it-all/internal/fs"
)

// open makes a store and routes the app's atomic writes through it.
func open(t *testing.T, exclude ...string) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	s, err := Open(filepath.Join(root, "history"), exclude...)
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Unix(1_700_000_000, 0)
	s.now = func() time.Time { clock = clock.Add(time.Second); return clock }
	hfs.SetVersioner(s)
	t.Cleanup(func() { hfs.SetVersioner(nil); s.Close() })
	return s, root
}

func save(t *testing.T, p, content string) {
	t.Helper()
	if err := hfs.AtomicWriteFile(p, []byte(content)); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, s *Store, hash string) string {
	t.Helper()
	rc, err := s.OpenVersion(hash)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	b, _ := io.ReadAll(rc)
	return string(b)
}

func kinds(f File) string {
	var k []string
	for _, e := range f.Entries {
		k = append(k, e.Kind)
	}
	return strings.Join(k, ",")
}

func TestSavesAreKeptInOrder(t *testing.T) {
	s, root := open(t)
	p := filepath.Join(root, "notes.md")
	os.WriteFile(p, []byte("v0"), 0o644)
	save(t, p, "v1")
	save(t, p, "v2")
	save(t, p, "v2") // no change: no new version
	f := s.History(p)
	if got := kinds(f); got != "saved,saved,original" {
		t.Fatalf("kinds %s", got)
	}
	for i, want := range []string{"v2", "v1", "v0"} {
		if got := read(t, s, f.Entries[i].Hash); got != want {
			t.Errorf("version %d: %q, want %q", i, got, want)
		}
	}
	if f.Current != f.Entries[0].Hash {
		t.Errorf("current %s, newest %s", f.Current, f.Entries[0].Hash)
	}
	if !f.Exists || f.Entries[0].Time <= f.Entries[1].Time {
		t.Errorf("exists %v, times %v", f.Exists, f.Entries)
	}
}

func TestChangeOutsideTheApp(t *testing.T) {
	s, root := open(t)
	p := filepath.Join(root, "a.txt")
	save(t, p, "mine")
	os.WriteFile(p, []byte("theirs"), 0o644) // another program, in place
	save(t, p, "mine again")
	if got := kinds(s.History(p)); got != "saved,outside,saved" {
		t.Fatalf("kinds %s", got)
	}
}

func TestRestoreKeepsTheCurrentContent(t *testing.T) {
	s, root := open(t)
	p := filepath.Join(root, "a.txt")
	os.WriteFile(p, []byte("first"), 0o644)
	save(t, p, "second")
	orig := s.History(p).Entries[1]
	if err := s.Restore(p, orig.Hash, hfs.AtomicWriteReader); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "first" {
		t.Fatalf("restored %q", b)
	}
	f := s.History(p)
	if got := kinds(f); got != "restored,saved,original" {
		t.Fatalf("kinds %s", got)
	}
	if f.Entries[0].Note == "" || read(t, s, f.Entries[1].Hash) != "second" {
		t.Errorf("note %q / the replaced version kept", f.Entries[0].Note)
	}
	if err := s.Restore(p, "nope", hfs.AtomicWriteReader); err == nil {
		t.Error("unknown version restored")
	}
}

func TestRestoreADeletedFile(t *testing.T) {
	s, root := open(t)
	p := filepath.Join(root, "sub", "gone.txt")
	os.MkdirAll(filepath.Dir(p), 0o755)
	save(t, p, "keep me")
	h := s.History(p).Entries[0].Hash
	os.RemoveAll(filepath.Dir(p))
	if s.History(p).Exists {
		t.Fatal("still exists")
	}
	files := s.Files()
	if len(files) != 1 || files[0].Exists || files[0].Path != p {
		t.Fatalf("files %+v", files)
	}
	if err := s.Restore(p, h, hfs.AtomicWriteReader); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "keep me" {
		t.Fatalf("got %q", b)
	}
}

func TestAppDataAndLargeFilesAreNotVersioned(t *testing.T) {
	root0 := t.TempDir()
	cfg := filepath.Join(root0, "config")
	os.MkdirAll(cfg, 0o755)
	s, root := open(t, cfg)
	save(t, filepath.Join(cfg, "settings.json"), "{}")
	save(t, filepath.Join(cfg, "settings.json"), `{"a":1}`)
	if n := len(s.Files()); n != 0 {
		t.Fatalf("app data versioned: %d", n)
	}
	s.Configure(true, Limits{MaxFileBytes: 10})
	big := filepath.Join(root, "big.bin")
	save(t, big, strings.Repeat("x", 100))
	if n := len(s.History(big).Entries); n != 0 {
		t.Fatalf("large file versioned: %d", n)
	}
	s.Configure(false, Limits{})
	small := filepath.Join(root, "small.txt")
	save(t, small, "a")
	save(t, small, "b")
	if n := len(s.History(small).Entries); n != 0 {
		t.Fatalf("versioned while off: %d", n)
	}
}

func TestLimits(t *testing.T) {
	s, root := open(t)
	s.Configure(true, Limits{MaxPerFile: 3})
	p := filepath.Join(root, "a.txt")
	for i := 0; i < 6; i++ {
		save(t, p, strings.Repeat("v", i+1))
	}
	f := s.History(p)
	if len(f.Entries) != 3 || read(t, s, f.Entries[0].Hash) != "vvvvvv" {
		t.Fatalf("per-file limit: %d versions", len(f.Entries))
	}
	// Total size: old versions of all files go, oldest first; each file keeps its newest.
	s.Configure(true, Limits{MaxPerFile: 100, MaxTotal: 1})
	q := filepath.Join(root, "b.txt")
	save(t, q, "b1")
	save(t, q, "b2")
	if n := len(s.History(p).Entries); n != 1 {
		t.Errorf("a.txt kept %d versions", n)
	}
	if f := s.History(q); len(f.Entries) != 1 || read(t, s, f.Entries[0].Hash) != "b2" {
		t.Errorf("b.txt kept %d versions", len(f.Entries))
	}
	blobs := 0
	filepath.WalkDir(filepath.Join(s.dir, "blobs"), func(_ string, d os.DirEntry, _ error) error {
		if d != nil && !d.IsDir() {
			blobs++
		}
		return nil
	})
	if blobs != 2 {
		t.Errorf("%d contents left, want 2", blobs)
	}
}

func TestSameContentStoredOnce(t *testing.T) {
	s, root := open(t)
	a, b := filepath.Join(root, "a.txt"), filepath.Join(root, "b.txt")
	save(t, a, "same")
	save(t, b, "same")
	before := s.Usage()
	save(t, a, "other")
	save(t, a, "same")
	if got := len(s.History(a).Entries); got != 3 {
		t.Fatalf("%d versions", got)
	}
	if s.Usage() <= before || s.Usage() > before*3 {
		t.Errorf("usage %d → %d", before, s.Usage())
	}
}

func TestCompressedFormatsStoredAsIs(t *testing.T) {
	s, root := open(t)
	text := filepath.Join(root, "big.txt")
	save(t, text, strings.Repeat("hello history ", 10000))
	if u := s.Usage(); u > 2000 {
		t.Errorf("text not compressed: %d bytes", u)
	}
	png := filepath.Join(root, "pic.png")
	data := bytes.Repeat([]byte{1, 2, 3}, 1000)
	if err := hfs.AtomicWriteFile(png, data); err != nil {
		t.Fatal(err)
	}
	h := s.History(png).Entries[0].Hash
	if _, err := os.Stat(filepath.Join(s.dir, "blobs", h[:2], h)); err != nil {
		t.Errorf("png stored compressed: %v", err)
	}
	if read(t, s, h) != string(data) {
		t.Error("png content")
	}
}

func TestMovedAndForget(t *testing.T) {
	s, root := open(t)
	dir := filepath.Join(root, "docs")
	os.MkdirAll(dir, 0o755)
	p := filepath.Join(dir, "a.txt")
	save(t, p, "1")
	save(t, p, "2")
	nd := filepath.Join(root, "papers")
	os.Rename(dir, nd)
	s.Moved(dir, nd)
	np := filepath.Join(nd, "a.txt")
	if n := len(s.History(np).Entries); n != 2 {
		t.Fatalf("moved: %d", n)
	}
	if n := len(s.History(p).Entries); n != 0 {
		t.Fatalf("old path keeps %d", n)
	}
	s.Forget(np)
	if len(s.Files()) != 0 || s.Usage() != 0 {
		t.Fatalf("forget: %d files, %d bytes", len(s.Files()), s.Usage())
	}
}

func TestSkip(t *testing.T) {
	s, root := open(t)
	s.Skip = func(abs string) bool { return strings.Contains(abs, "work-") }
	p := filepath.Join(root, "work-1", "a.txt")
	os.MkdirAll(filepath.Dir(p), 0o755)
	save(t, p, "1")
	save(t, p, "2")
	if n := len(s.Files()); n != 0 {
		t.Fatalf("skipped file versioned: %d", n)
	}
}
