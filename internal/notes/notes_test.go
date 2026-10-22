package notes

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseLinksAndHeadings(t *testing.T) {
	text := strings.Join([]string{
		"---",
		"title: [[Not a link]]",
		"---",
		"# Plan",
		"See [[Ideas]] and [[projects/Roadmap#Q3|the roadmap]], ![[diagram.png]].",
		"A [Markdown link](Other%20note.md#Intro) and [web](https://example.com/a.md) and [here](#plan).",
		"`[[code]]` is not a link, nor [x](y.txt).",
		"```",
		"[[Fenced]]",
		"```",
		"## Next steps ##",
		"[[#Plan]]",
	}, "\n")
	links, heads := Parse(text)
	type L struct {
		target, heading string
		wiki, embed     bool
		line            int
	}
	var got []L
	for _, l := range links {
		got = append(got, L{l.Target, l.Heading, l.Wiki, l.Embed, l.Line})
	}
	want := []L{
		{"Ideas", "", true, false, 5},
		{"projects/Roadmap", "Q3", true, false, 5},
		{"diagram.png", "", true, true, 5},
		{"Other note.md", "Intro", false, false, 6},
		{"", "Plan", true, false, 12},
	}
	if len(got) != len(want) {
		t.Fatalf("links = %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("link %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if links[0].Text != "See [[Ideas]] and [[projects/Roadmap#Q3|the roadmap]], ![[diagram.png]]." {
		t.Errorf("context = %q", links[0].Text)
	}
	if len(heads) != 2 || heads[0] != (Heading{1, "Plan", 4}) || heads[1] != (Heading{2, "Next steps", 11}) {
		t.Errorf("headings = %+v", heads)
	}
}

func TestLongLineContextIsTrimmedAroundTheLink(t *testing.T) {
	line := strings.Repeat("ż", 300) + " [[Target]] " + strings.Repeat("x", 300)
	links, _ := Parse(line)
	if len(links) != 1 {
		t.Fatal(links)
	}
	s := links[0].Text
	if !strings.Contains(s, "[[Target]]") || len(s) > textWindow+10 || !strings.HasPrefix(s, "…") || !strings.HasSuffix(s, "…") {
		t.Errorf("context = %q", s)
	}
	if !strings.Contains(s, "ż") || strings.ContainsRune(s, '�') {
		t.Errorf("cut inside a character: %q", s)
	}
}

func TestScanIndexesNotesAndReusesUnchangedOnes(t *testing.T) {
	root := t.TempDir()
	write := func(rel, s string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("a.md", "# A\n[[b]]\n")
	write("sub/b.md", "back to [[a]]\n")
	write("c.txt", "[[a]]\n")
	write(".hidden/d.md", "[[a]]\n")
	write("node_modules/e.md", "[[a]]\n")
	write(".obsidian/f.md", "[[a]]\n")

	s := NewScanner()
	idx, err := s.Scan(context.Background(), root, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(idx.Notes) != 2 || idx.Notes[0].Path != filepath.Join(root, "a.md") || idx.Notes[1].Path != filepath.Join(root, "sub", "b.md") {
		t.Fatalf("notes = %+v", idx.Notes)
	}
	if idx.Notes[1].Links[0].Target != "a" || idx.Notes[0].Headings[0].Text != "A" {
		t.Errorf("parsed = %+v", idx.Notes)
	}

	// Unchanged files come from the cache; a changed one is read again.
	e := s.cache[filepath.Join(root, "a.md")]
	e.note = Note{Path: e.note.Path, Links: []Link{}, Headings: []Heading{{1, "cached", 1}}}
	s.cache[filepath.Join(root, "a.md")] = e
	write("sub/b.md", "now [[c]]\n")
	later := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(filepath.Join(root, "sub", "b.md"), later, later)
	idx, _ = s.Scan(context.Background(), root, false)
	if idx.Notes[0].Headings[0].Text != "cached" {
		t.Errorf("unchanged note was re-read: %+v", idx.Notes[0])
	}
	if got := idx.Notes[1].Links[0].Target; got != "c" {
		t.Errorf("changed note not re-read: %q", got)
	}

	idx, _ = s.Scan(context.Background(), root, true)
	if len(idx.Notes) != 3 {
		t.Errorf("with hidden: %d notes", len(idx.Notes))
	}
}
