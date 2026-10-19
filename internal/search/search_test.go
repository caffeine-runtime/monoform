package search

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"
)

func setup(t *testing.T) string {
	dir := t.TempDir()
	write := func(rel, s string) {
		p := filepath.Join(dir, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	write("a.txt", "hello world\nHello again\nnothing\n")
	write("sub/b.md", "# Title\nsay hello\r\nhelloworld\n")
	write(".hidden/c.txt", "hello hidden\n")
	write("node_modules/x.js", "hello from deps\n")
	write("bin.dat", "hello\x00binary")
	write("zł.txt", "zażółć hello\n")
	return dir
}

func collect(t *testing.T, root string, o Options) ([]Match, Summary) {
	t.Helper()
	var mu sync.Mutex
	var all []Match
	sum, err := Run(context.Background(), root, o, Sink{Matches: func(m []Match) {
		mu.Lock()
		all = append(all, m...)
		mu.Unlock()
	}})
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Path != all[j].Path {
			return all[i].Path < all[j].Path
		}
		return all[i].Line < all[j].Line
	})
	return all, sum
}

func TestCaseInsensitiveDefault(t *testing.T) {
	root := setup(t)
	ms, sum := collect(t, root, Options{Query: "hello"})
	// a.txt: 2, sub/b.md: 2, zł.txt: 1 ; hidden, node_modules, binary skipped
	if len(ms) != 5 || sum.Files != 3 {
		t.Fatalf("got %d matches in %d files: %+v", len(ms), sum.Files, ms)
	}
	for _, m := range ms {
		if filepath.Base(m.Path) == "zł.txt" {
			if m.Col != 8 || m.Len != 5 {
				t.Fatalf("unicode column: %+v", m)
			}
		}
		if m.Text[m.At:m.At+5] != "hello" && m.Text[m.At:m.At+5] != "Hello" {
			// At is in characters; these lines are ASCII before the match.
			if filepath.Base(m.Path) != "zł.txt" {
				t.Fatalf("At wrong: %+v", m)
			}
		}
	}
}

func TestOptions(t *testing.T) {
	root := setup(t)
	ms, _ := collect(t, root, Options{Query: "Hello", CaseSensitive: true})
	if len(ms) != 1 || ms[0].Line != 2 {
		t.Fatalf("case sensitive: %+v", ms)
	}
	ms, _ = collect(t, root, Options{Query: "hello", WholeWord: true})
	for _, m := range ms {
		if m.Text == "helloworld" {
			t.Fatal("whole word matched helloworld")
		}
	}
	if len(ms) != 4 {
		t.Fatalf("whole word count %d", len(ms))
	}
	ms, _ = collect(t, root, Options{Query: `^#\s+\w+`, Regex: true})
	if len(ms) != 1 || ms[0].Len != 7 {
		t.Fatalf("regex: %+v", ms)
	}
	ms, _ = collect(t, root, Options{Query: "hidden", ShowHidden: true})
	if len(ms) != 1 {
		t.Fatalf("hidden: %+v", ms)
	}
	// CRLF lines: the \r is not part of the text.
	ms, _ = collect(t, root, Options{Query: "say hello"})
	if len(ms) != 1 || ms[0].Text != "say hello" {
		t.Fatalf("crlf: %+v", ms)
	}
	if _, err := Compile(Options{Query: "(", Regex: true}); err == nil {
		t.Fatal("bad regex accepted")
	}
}

func TestMaxResults(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 20; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.txt", i)), []byte("x\nx\nx\nx\nx\n"), 0o644)
	}
	ms, sum := collect(t, dir, Options{Query: "x", MaxResults: 12})
	if len(ms) != 12 || !sum.Truncated || sum.Matches != 12 {
		t.Fatalf("got %d, %+v", len(ms), sum)
	}
}

func TestCancel(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 2000; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%04d.txt", i)), []byte("needle\n"), 0o644)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		Run(ctx, dir, Options{Query: "needle", MaxResults: 1 << 30}, Sink{})
		close(done)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("search did not stop after cancel")
	}
}
