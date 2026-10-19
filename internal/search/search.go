// Package search finds text across a folder. Files are scanned in parallel,
// matches are streamed in batches, and the whole search stops as soon as the
// context is cancelled.
package search

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

type Options struct {
	Query         string `json:"query"`
	CaseSensitive bool   `json:"caseSensitive"`
	WholeWord     bool   `json:"wholeWord"`
	Regex         bool   `json:"regex"`
	ShowHidden    bool   `json:"showHidden"`
	MaxResults    int    `json:"maxResults"`
	MaxFileSize   int64  `json:"maxFileSize"`
}

type Match struct {
	Path string `json:"path"`
	Line int    `json:"line"` // 1-based
	Col  int    `json:"col"`  // 1-based, in characters
	Len  int    `json:"len"`  // match length in characters
	Text string `json:"text"` // the line, trimmed to a window around the match
	// Offset of the match within Text (characters).
	At int `json:"at"`
}

type Summary struct {
	Files     int  `json:"files"`
	Scanned   int  `json:"scanned"`
	Matches   int  `json:"matches"`
	Truncated bool `json:"truncated"`
}

// Progress is called with (filesScanned, filesFound) roughly as work proceeds.
type Sink struct {
	Matches  func([]Match)
	Progress func(scanned, found int64)
}

var skipDirs = map[string]bool{".git": true, ".hg": true, ".svn": true, "node_modules": true, "__pycache__": true, ".venv": true, "target": false}

const (
	defaultMaxResults = 5000
	defaultMaxSize    = 20 << 20
	lineWindow        = 160
)

// Compile turns options into a regexp.
func Compile(o Options) (*regexp.Regexp, error) {
	if o.Query == "" {
		return nil, errors.New("empty query")
	}
	pat := o.Query
	if !o.Regex {
		pat = regexp.QuoteMeta(pat)
	}
	if o.WholeWord {
		pat = `\b(?:` + pat + `)\b`
	}
	if !o.CaseSensitive {
		pat = "(?i)" + pat
	}
	return regexp.Compile(pat)
}

// Run searches root and reports matches through sink. It returns when done
// or when ctx is cancelled.
func Run(ctx context.Context, root string, o Options, sink Sink) (Summary, error) {
	re, err := Compile(o)
	if err != nil {
		return Summary{}, err
	}
	if o.MaxResults <= 0 {
		o.MaxResults = defaultMaxResults
	}
	if o.MaxFileSize <= 0 {
		o.MaxFileSize = defaultMaxSize
	}
	// A literal, case-sensitive query can skip files with a fast bytes check.
	var literal []byte
	if !o.Regex && o.CaseSensitive {
		literal = []byte(o.Query)
	}

	parent := ctx
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	paths := make(chan string, 256)
	var scanned, found, total atomic.Int64
	var truncated atomic.Bool

	// Batch matches so the frontend gets a few events per second, not thousands.
	var mu sync.Mutex
	var batch []Match
	flush := func() {
		mu.Lock()
		b := batch
		batch = nil
		mu.Unlock()
		if len(b) > 0 && sink.Matches != nil {
			sink.Matches(b)
		}
	}
	stopTicker := make(chan struct{})
	tickerDone := make(chan struct{})
	go func() {
		defer close(tickerDone)
		t := time.NewTicker(80 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				flush()
				if sink.Progress != nil {
					sink.Progress(scanned.Load(), found.Load())
				}
			case <-stopTicker:
				return
			}
		}
	}()

	var wg sync.WaitGroup
	workers := runtime.NumCPU()
	if workers > 8 {
		workers = 8
	}
	var filesWithMatches atomic.Int64
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf := make([]byte, 0, 64<<10)
			for p := range paths {
				if ctx.Err() != nil {
					continue
				}
				ms, b, err := searchFile(p, re, literal, o.MaxFileSize, buf)
				buf = b
				scanned.Add(1)
				if err != nil || len(ms) == 0 {
					continue
				}
				filesWithMatches.Add(1)
				n := total.Add(int64(len(ms)))
				if over := n - int64(o.MaxResults); over > 0 {
					keep := len(ms) - int(over)
					if keep <= 0 {
						truncated.Store(true)
						cancel()
						continue
					}
					ms = ms[:keep]
					truncated.Store(true)
					cancel()
				}
				mu.Lock()
				batch = append(batch, ms...)
				mu.Unlock()
			}
		}()
	}

	walkErr := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if ctx.Err() != nil {
			return filepath.SkipAll
		}
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if p != root && (skipDirs[name] || (!o.ShowHidden && strings.HasPrefix(name, "."))) {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() || (!o.ShowHidden && strings.HasPrefix(name, ".")) {
			return nil
		}
		found.Add(1)
		select {
		case paths <- p:
		case <-ctx.Done():
			return filepath.SkipAll
		}
		return nil
	})
	close(paths)
	wg.Wait()
	close(stopTicker)
	<-tickerDone
	flush()
	if sink.Progress != nil {
		sink.Progress(scanned.Load(), found.Load())
	}

	sum := Summary{Files: int(filesWithMatches.Load()), Scanned: int(scanned.Load()), Matches: int(min64(total.Load(), int64(o.MaxResults))), Truncated: truncated.Load()}
	if walkErr != nil {
		return sum, walkErr
	}
	// Cancellation by the caller (not by the result limit) is reported.
	return sum, parent.Err()
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// searchFile returns the matches in one file. Binary files (NUL bytes in the
// first 8 KB) and files larger than maxSize are skipped.
func searchFile(p string, re *regexp.Regexp, literal []byte, maxSize int64, buf []byte) ([]Match, []byte, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, buf, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.Size() > maxSize || st.Size() == 0 {
		return nil, buf, err
	}
	if int64(cap(buf)) < st.Size() {
		buf = make([]byte, 0, st.Size())
	}
	data := buf[:st.Size()]
	if _, err := io.ReadFull(f, data); err != nil {
		return nil, buf, err
	}
	head := data
	if len(head) > 8192 {
		head = head[:8192]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return nil, buf, nil
	}
	if literal != nil && !bytes.Contains(data, literal) {
		return nil, buf, nil
	}
	if literal == nil && !re.Match(data) {
		return nil, buf, nil
	}
	var out []Match
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 0, 64<<10), 16<<20)
	line := 0
	for sc.Scan() {
		line++
		text := sc.Bytes()
		locs := re.FindAllIndex(text, 50)
		for _, loc := range locs {
			out = append(out, makeMatch(p, line, text, loc[0], loc[1]))
		}
	}
	return out, buf, nil
}

func makeMatch(p string, line int, text []byte, start, end int) Match {
	text = bytes.TrimRight(text, "\r")
	if end > len(text) {
		end = len(text)
	}
	if start > end {
		start = end
	}
	col := utf8.RuneCount(text[:start]) + 1
	mlen := utf8.RuneCount(text[start:end])
	// Window the line around the match for display.
	ws := start
	for i := 0; i < lineWindow/3 && ws > 0; i++ {
		_, size := utf8.DecodeLastRune(text[:ws])
		ws -= size
	}
	we := end
	for i := 0; i < lineWindow && we < len(text); i++ {
		_, size := utf8.DecodeRune(text[we:])
		we += size
	}
	lead := bytes.TrimLeft(text[ws:start], " \t")
	shown := string(lead) + string(text[start:we])
	if ws > 0 {
		shown = "…" + shown
	}
	at := utf8.RuneCountInString(shown) - utf8.RuneCount(text[start:we])
	return Match{Path: p, Line: line, Col: col, Len: mlen, Text: shown, At: at}
}
