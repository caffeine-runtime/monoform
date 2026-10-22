// Package notes indexes the Markdown notes in a folder for Obsidian-style
// linking: every [[wiki link]], ![[embed]] and relative [text](note.md) link
// with the line it is on, and every heading. The editor resolves links and
// builds backlinks from it. Files are parsed in parallel and remembered by
// size and modification time, so re-indexing a folder after an edit only
// reads what changed.
package notes

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Line  int    `json:"line"` // 1-based
}

type Link struct {
	// Target as written: "Note", "folder/Note", "Note.md" for wiki links; a
	// relative path ("../a b.md", URL-decoded) for Markdown links.
	Target string `json:"target"`
	// Heading after '#', if any.
	Heading string `json:"heading,omitempty"`
	Wiki    bool   `json:"wiki"`
	Embed   bool   `json:"embed,omitempty"`
	Line    int    `json:"line"` // 1-based
	// Text is the line the link is on (trimmed, at most ~200 characters around the link).
	Text string `json:"text"`
}

type Note struct {
	Path     string    `json:"path"`
	Links    []Link    `json:"links"`
	Headings []Heading `json:"headings"`
}

type Index struct {
	Root  string `json:"root"`
	Notes []Note `json:"notes"`
	// Truncated is set when the folder has more notes than MaxNotes.
	Truncated bool `json:"truncated"`
}

const (
	MaxNotes    = 20000
	MaxNoteSize = 4 << 20
	textWindow  = 200
)

var skipDirs = map[string]bool{".git": true, ".hg": true, ".svn": true, "node_modules": true, "__pycache__": true, ".venv": true, ".obsidian": true, ".trash": true}

// IsNote reports whether a file name is a Markdown note.
func IsNote(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".markdown", ".mdown", ".mkd":
		return true
	}
	return false
}

var (
	wikiRe   = regexp.MustCompile(`(!?)\[\[([^\[\]\n]+?)\]\]`)
	mdRe     = regexp.MustCompile(`(!?)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)`)
	codeRe   = regexp.MustCompile("`+[^`\n]*`+")
	headRe   = regexp.MustCompile(`^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$`)
	fenceRe  = regexp.MustCompile("^ {0,3}(```|~~~)")
	schemeRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)
)

// Parse returns the links and headings in a note. Links inside code (fenced
// blocks and `inline code`) and in YAML front matter are ignored.
func Parse(text string) ([]Link, []Heading) {
	links := []Link{}
	heads := []Heading{}
	lines := strings.Split(text, "\n")
	fence := ""
	start := 0
	if len(lines) > 0 && strings.TrimRight(lines[0], "\r") == "---" {
		for i := 1; i < len(lines); i++ {
			if t := strings.TrimRight(lines[i], "\r"); t == "---" || t == "..." {
				start = i + 1
				break
			}
		}
	}
	for i := start; i < len(lines); i++ {
		line := strings.TrimRight(lines[i], "\r")
		if m := fenceRe.FindStringSubmatch(line); m != nil {
			if fence == "" {
				fence = m[1]
			} else if fence == m[1] {
				fence = ""
			}
			continue
		}
		if fence != "" {
			continue
		}
		if m := headRe.FindStringSubmatch(line); m != nil {
			heads = append(heads, Heading{Level: len(m[1]), Text: strings.TrimSpace(m[2]), Line: i + 1})
		}
		if !strings.Contains(line, "[") {
			continue
		}
		// Blank out inline code so links in it don't count (columns stay the same).
		plain := codeRe.ReplaceAllStringFunc(line, func(s string) string { return strings.Repeat(" ", len(s)) })
		for _, m := range wikiRe.FindAllStringSubmatchIndex(plain, -1) {
			inner := plain[m[4]:m[5]]
			if p := strings.IndexByte(inner, '|'); p >= 0 {
				inner = inner[:p]
			}
			target, head, _ := strings.Cut(inner, "#")
			target = strings.TrimSpace(target)
			if target == "" && head == "" {
				continue
			}
			links = append(links, Link{Target: target, Heading: strings.TrimSpace(head), Wiki: true, Embed: m[3] > m[2], Line: i + 1, Text: window(line, m[0], m[1])})
		}
		for _, m := range mdRe.FindAllStringSubmatchIndex(plain, -1) {
			href := plain[m[4]:m[5]]
			if schemeRe.MatchString(href) && !isWinPath(href) || strings.HasPrefix(href, "#") {
				continue
			}
			p, head, _ := strings.Cut(href, "#")
			if dec, err := url.PathUnescape(p); err == nil {
				p = dec
			}
			if !IsNote(p) {
				continue
			}
			if dec, err := url.PathUnescape(head); err == nil {
				head = dec
			}
			links = append(links, Link{Target: p, Heading: head, Embed: m[3] > m[2], Line: i + 1, Text: window(line, m[0], m[1])})
		}
	}
	return links, heads
}

func isWinPath(s string) bool {
	return len(s) > 2 && s[1] == ':' && (s[2] == '\\' || s[2] == '/')
}

// window trims a long line to about textWindow bytes around [from, to), on rune boundaries.
func window(line string, from, to int) string {
	s := strings.TrimSpace(line)
	if len(line) <= textWindow {
		return s
	}
	lo := max(0, from-(textWindow-(to-from))/2)
	hi := min(len(line), lo+textWindow)
	for lo > 0 && !utf8.RuneStart(line[lo]) {
		lo--
	}
	for hi < len(line) && !utf8.RuneStart(line[hi]) {
		hi++
	}
	out := strings.TrimSpace(line[lo:hi])
	if lo > 0 {
		out = "…" + out
	}
	if hi < len(line) {
		out += "…"
	}
	return out
}

type entry struct {
	size int64
	mod  time.Time
	note Note
}

// Scanner indexes folders, remembering parsed notes between scans.
type Scanner struct {
	mu    sync.Mutex
	cache map[string]entry
}

func NewScanner() *Scanner { return &Scanner{cache: map[string]entry{}} }

// Scan indexes the notes under root (hidden files and folders only with showHidden).
func (s *Scanner) Scan(ctx context.Context, root string, showHidden bool) (Index, error) {
	type job struct {
		path string
		info os.FileInfo
	}
	var found []job
	truncated := false
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if ctx.Err() != nil {
			return filepath.SkipAll
		}
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if p != root && (skipDirs[name] || (!showHidden && strings.HasPrefix(name, "."))) {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() || !IsNote(name) || (!showHidden && strings.HasPrefix(name, ".")) {
			return nil
		}
		if len(found) >= MaxNotes {
			truncated = true
			return filepath.SkipAll
		}
		info, err := d.Info()
		if err != nil || info.Size() > MaxNoteSize {
			return nil
		}
		found = append(found, job{p, info})
		return nil
	})
	if err != nil {
		return Index{}, err
	}
	if err := ctx.Err(); err != nil {
		return Index{}, err
	}

	notes := make([]Note, len(found))
	var todo []int
	s.mu.Lock()
	for i, j := range found {
		if e, ok := s.cache[j.path]; ok && e.size == j.info.Size() && e.mod.Equal(j.info.ModTime()) {
			notes[i] = e.note
		} else {
			todo = append(todo, i)
		}
	}
	s.mu.Unlock()

	var wg sync.WaitGroup
	next := make(chan int)
	for w := 0; w < min(runtime.NumCPU(), 8); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				j := found[i]
				data, err := os.ReadFile(j.path)
				if err != nil || bytes.IndexByte(data[:min(len(data), 8000)], 0) >= 0 {
					notes[i] = Note{Path: j.path, Links: []Link{}, Headings: []Heading{}}
					continue
				}
				links, heads := Parse(string(data))
				notes[i] = Note{Path: j.path, Links: links, Headings: heads}
				s.mu.Lock()
				s.cache[j.path] = entry{size: j.info.Size(), mod: j.info.ModTime(), note: notes[i]}
				s.mu.Unlock()
			}
		}()
	}
	for _, i := range todo {
		if ctx.Err() != nil {
			break
		}
		next <- i
	}
	close(next)
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return Index{}, err
	}
	sort.Slice(notes, func(a, b int) bool { return notes[a].Path < notes[b].Path })
	return Index{Root: root, Notes: notes, Truncated: truncated}, nil
}
