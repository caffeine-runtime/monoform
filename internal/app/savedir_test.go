package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveDir(t *testing.T) {
	abs, _ := filepath.Abs(filepath.Join("some", "folder"))
	docs, _ := filepath.Abs("docs")
	last, _ := filepath.Abs("last")
	cases := []struct{ suggested, last, want string }{
		{filepath.Join(abs, "a.txt"), last, abs}, // the file's own folder wins
		{"Untitled.md", "", docs},                // a bare name: Documents…
		{"Untitled.md", last, last},              // …or where the user last saved
		{filepath.Join(".", "x.svg"), "", docs},  // never relative to the working directory
		{"", "", docs},
	}
	for _, c := range cases {
		if got := saveDir(c.suggested, c.last, docs); got != c.want {
			t.Errorf("saveDir(%q, %q) = %q, want %q", c.suggested, c.last, got, c.want)
		}
	}
}

func TestOpenDir(t *testing.T) {
	docs := t.TempDir()
	last := t.TempDir()
	gone := filepath.Join(last, "removed")
	cases := []struct{ last, want string }{
		{"", docs},         // the first dialog: Documents
		{last, last},       // then where the user last picked from
		{gone, docs},       // unless that folder is gone
		{"relative", docs}, // never relative to the working directory
	}
	for _, c := range cases {
		if got := openDir(c.last, docs); got != c.want {
			t.Errorf("openDir(%q) = %q, want %q", c.last, got, c.want)
		}
	}
}

func TestXDGDocuments(t *testing.T) {
	home := t.TempDir()
	os.MkdirAll(filepath.Join(home, ".config"), 0o755)
	os.MkdirAll(filepath.Join(home, "Dokumenty"), 0o755)
	write := func(s string) {
		os.WriteFile(filepath.Join(home, ".config", "user-dirs.dirs"), []byte(s), 0o644)
	}
	write("# comment\nXDG_DESKTOP_DIR=\"$HOME/Pulpit\"\nXDG_DOCUMENTS_DIR=\"$HOME/Dokumenty\"\n")
	if got := xdgDocuments(home); got != filepath.Join(home, "Dokumenty") {
		t.Errorf("got %q", got)
	}
	write("XDG_DOCUMENTS_DIR=\"$HOME/\"\n")
	if got := xdgDocuments(home); got != "" {
		t.Errorf("home itself should not count, got %q", got)
	}
}
