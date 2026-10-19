package semantic

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPassages(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 40; i++ {
		b.WriteString("Paragraph ")
		b.WriteString(strings.Repeat("word ", 30))
		b.WriteString("\n\n")
	}
	ps := Passages(b.String(), 100)
	if len(ps) < 6 {
		t.Fatalf("got %d passages", len(ps))
	}
	for _, p := range ps {
		if len(p.Text) > PassageChars+200 {
			t.Fatalf("passage too long: %d", len(p.Text))
		}
		if !strings.HasPrefix(p.Text, "Paragraph") {
			t.Fatalf("passage doesn't start at a paragraph: %q", p.Text[:20])
		}
	}
	if ps[0].Line != 1 || ps[1].Line <= 1 {
		t.Fatalf("lines: %d %d", ps[0].Line, ps[1].Line)
	}
	// Line numbers point at the passage start.
	lines := strings.Split(b.String(), "\n")
	for _, p := range ps {
		if !strings.HasPrefix(lines[p.Line-1], "Paragraph") {
			t.Fatalf("line %d is %q", p.Line, lines[p.Line-1])
		}
	}
	if got := Passages(b.String(), 3); len(got) != 3 {
		t.Fatalf("cap: %d", len(got))
	}
	// One giant line is cut on rune boundaries.
	long := strings.Repeat("żółw ", 1000)
	for _, p := range Passages(long, 100) {
		if !strings.HasPrefix(p.Text, "żółw") && !strings.HasPrefix(p.Text, "ółw") && !strings.HasPrefix(p.Text, "łw") && !strings.HasPrefix(p.Text, "w") {
			t.Fatalf("bad cut: %q", p.Text[:10])
		}
	}
	if len(Passages("  \n\n \r\n", 8)) != 0 {
		t.Fatal("blank text gives passages")
	}
}

func unit(seed int) []float32 {
	v := make([]float32, Model.Dims)
	var n float64
	for i := range v {
		v[i] = float32(math.Sin(float64(seed*7919 + i*31)))
		n += float64(v[i] * v[i])
	}
	for i := range v {
		v[i] /= float32(math.Sqrt(n))
	}
	return v
}

func TestIndex(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a.md"), []byte("# A\n\nalpha"), 0o644)
	os.WriteFile(filepath.Join(root, "b.txt"), []byte("beta beta"), 0o644)
	os.WriteFile(filepath.Join(root, "go.sum"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(root, "img.png"), []byte("\x89PNG"), 0o644)
	os.MkdirAll(filepath.Join(root, "node_modules"), 0o755)
	os.WriteFile(filepath.Join(root, "node_modules", "c.md"), []byte("c"), 0o644)
	dir := filepath.Join(t.TempDir(), "index")
	s := NewStore(dir)

	p := s.Pending(root)
	if p.Total != 2 || len(p.Files) != 2 || p.Indexed != 0 {
		t.Fatalf("pending: %+v", p)
	}
	for i, f := range p.Files {
		size, mod, ps, err := ReadPassages(f.Path)
		if err != nil || len(ps) == 0 {
			t.Fatal(err, ps)
		}
		items := []Item{{Line: ps[0].Line, Text: ps[0].Text, Vector: unit(i)}}
		if err := s.Put(root, f.Path, size, mod, items, PutAll); err != nil {
			t.Fatal(err)
		}
	}
	hits, err := s.Query(root, unit(1), 5)
	if err != nil || len(hits) != 2 {
		t.Fatal(err, hits)
	}
	if hits[0].Path != p.Files[1].Path || hits[0].Score < 0.98 || hits[1].Score > 0.9 {
		t.Fatalf("ranking: %+v", hits)
	}
	if err := s.Flush(); err != nil {
		t.Fatal(err)
	}

	// Reload from disk: same results, nothing pending.
	s2 := NewStore(dir)
	if p2 := s2.Pending(root); len(p2.Files) != 0 || p2.Indexed != 2 || p2.Passages != 2 {
		t.Fatalf("after reload: %+v", p2)
	}
	hits2, _ := s2.Query(root, unit(1), 5)
	if hits2[0].Path != hits[0].Path || math.Abs(float64(hits2[0].Score-hits[0].Score)) > 1e-6 {
		t.Fatalf("reloaded ranking differs: %+v vs %+v", hits2, hits)
	}

	// A changed file is pending again; a deleted one is dropped.
	time.Sleep(10 * time.Millisecond)
	os.WriteFile(filepath.Join(root, "a.md"), []byte("# A\n\nalpha changed"), 0o644)
	os.Remove(filepath.Join(root, "b.txt"))
	p3 := s2.Pending(root)
	if len(p3.Files) != 1 || filepath.Base(p3.Files[0].Path) != "a.md" || p3.Total != 1 {
		t.Fatalf("after change: %+v", p3)
	}
	if st := s2.Status(root); st.Files != 1 {
		t.Fatalf("status: %+v", st)
	}
	if err := s2.Put(root, filepath.Join(root, "..", "x"), 1, 1, nil, PutAll); err == nil {
		t.Fatal("put outside root accepted")
	}
	if err := s2.Put(root, filepath.Join(root, "a.md"), 1, 1, []Item{{Vector: []float32{1}}}, PutAll); err == nil {
		t.Fatal("wrong dimensions accepted")
	}
}

func TestTwoPass(t *testing.T) {
	root := t.TempDir()
	long := filepath.Join(root, "long.md")
	var b strings.Builder
	for i := 0; i < 30; i++ {
		b.WriteString(strings.Repeat("words ", 40) + "\n\n")
	}
	os.WriteFile(long, []byte(b.String()), 0o644)
	os.WriteFile(filepath.Join(root, "short.txt"), []byte("short"), 0o644)
	s := NewStore(filepath.Join(t.TempDir(), "index"))
	p := s.Pending(root)
	if len(p.Files) != 2 || p.Files[0].Partial || p.Files[1].Partial {
		t.Fatalf("first pass: %+v", p)
	}
	size, mod, ps, _ := ReadPassages(long)
	if len(ps) < 3 {
		t.Fatalf("passages: %d", len(ps))
	}
	if err := s.Put(root, long, size, mod, []Item{{Line: ps[0].Line, Text: ps[0].Text, Vector: unit(1)}}, PutFirst); err != nil {
		t.Fatal(err)
	}
	p = s.Pending(root)
	if len(p.Files) != 2 || p.Files[0].Partial || !p.Files[1].Partial || filepath.Base(p.Files[1].Path) != "long.md" {
		t.Fatalf("partial ordering: %+v", p.Files)
	}
	if hits, _ := s.Query(root, unit(1), 1); len(hits) != 1 || hits[0].Line != ps[0].Line {
		t.Fatalf("partial entry not searchable: %+v", hits)
	}
	var rest []Item
	for i, x := range ps[1:] {
		rest = append(rest, Item{Line: x.Line, Text: x.Text, Vector: unit(10 + i)})
	}
	if err := s.Put(root, long, size, mod, rest, PutRest); err != nil {
		t.Fatal(err)
	}
	if hits, _ := s.Query(root, unit(11), 1); hits[0].Line != ps[2].Line {
		t.Fatalf("appended passage not found: %+v", hits)
	}
	p = s.Pending(root)
	if len(p.Files) != 1 || filepath.Base(p.Files[0].Path) != "short.txt" || p.Passages != len(ps) {
		t.Fatalf("after second pass: %+v", p)
	}
	// "rest" for a file that changed meanwhile is ignored.
	if err := s.Put(root, long, size+1, mod, rest, PutRest); err != nil {
		t.Fatal(err)
	}
	if st := s.Status(root); st.Passages != len(ps) {
		t.Fatalf("stale append applied: %+v", st)
	}
}

func TestDownload(t *testing.T) {
	// Serve fake files and swap in matching hashes for the test.
	saved := Model.Files
	defer func() { Model.Files = saved }()
	content := map[string][]byte{"a.json": []byte(`{"x":1}`), "onnx/b.bin": []byte(strings.Repeat("z", 3<<20))}
	Model.Files = nil
	for _, name := range []string{"a.json", "onnx/b.bin"} {
		h := sha256.Sum256(content[name])
		Model.Files = append(Model.Files, ModelFile{name, int64(len(content[name])), hex.EncodeToString(h[:])})
	}
	corrupt := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, ok := content[strings.TrimPrefix(r.URL.Path, "/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if corrupt {
			b = append([]byte{}, b...)
			b[0] ^= 1
		}
		w.Write(b)
	}))
	defer srv.Close()

	dir := filepath.Join(t.TempDir(), "model")
	corrupt = true
	if err := Download(context.Background(), dir, srv.URL, nil, func(int64, int64) {}); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("corrupt download: %v", err)
	}
	if Installed(dir) {
		t.Fatal("installed after a failed download")
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "*", ".part-*")); len(left) > 0 {
		t.Fatalf("partial files left: %v", left)
	}
	corrupt = false
	var last int64
	if err := Download(context.Background(), dir, srv.URL, nil, func(d, total int64) { last = d }); err != nil {
		t.Fatal(err)
	}
	if !Installed(dir) || last != ModelBytes() {
		t.Fatalf("installed=%v progress=%d", Installed(dir), last)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	os.Remove(filepath.Join(dir, "onnx", "b.bin"))
	if err := Download(ctx, dir, srv.URL, nil, func(int64, int64) {}); err == nil {
		t.Fatal("cancelled download succeeded")
	}
}
