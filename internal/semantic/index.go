package semantic

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/caffeine-runtime/hold-it-all/internal/filetype"
	"github.com/caffeine-runtime/hold-it-all/internal/fs"
)

// MaxFileSize is the largest file that is indexed.
const MaxFileSize = 1 << 20

// MaxFiles caps how many files of one folder are considered.
const MaxFiles = 20000

// skipNames are text files that are noise for search (lock files, sums).
var skipNames = map[string]bool{
	"go.sum": true, "package-lock.json": true, "yarn.lock": true, "pnpm-lock.yaml": true,
	"cargo.lock": true, "composer.lock": true, "poetry.lock": true, "gemfile.lock": true,
}

// Indexable reports whether a file is worth embedding: a text or markdown
// file of at most MaxFileSize bytes that isn't a lock file or minified asset.
func Indexable(p string, size int64) bool {
	if size <= 0 || size > MaxFileSize {
		return false
	}
	name := strings.ToLower(filepath.Base(p))
	if skipNames[name] || strings.HasSuffix(name, ".min.js") || strings.HasSuffix(name, ".min.css") || strings.HasSuffix(name, ".map") || strings.HasSuffix(name, ".lock") {
		return false
	}
	k := filetype.ByName(name).Kind
	return k == filetype.Text || k == filetype.Markdown
}

// ReadPassages reads a file and splits it into passages. Binary-looking
// files give no passages.
func ReadPassages(p string) (size, mod int64, out []Passage, err error) {
	st, err := os.Stat(p)
	if err != nil {
		return 0, 0, nil, err
	}
	if st.Size() > MaxFileSize {
		return st.Size(), st.ModTime().UnixMilli(), nil, nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return 0, 0, nil, err
	}
	if bytes.IndexByte(data[:min(len(data), 8192)], 0) >= 0 {
		return st.Size(), st.ModTime().UnixMilli(), nil, nil
	}
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	text := string(data)
	if !utf8.ValidString(text) {
		text = strings.ToValidUTF8(text, "�")
	}
	return st.Size(), st.ModTime().UnixMilli(), Passages(text, MaxPassages), nil
}

// Item is one embedded passage handed in by the frontend.
type Item struct {
	Line   int       `json:"line"`
	Text   string    `json:"text"`
	Vector []float32 `json:"vector"`
}

// Hit is a search result: the best passage of one file.
type Hit struct {
	Path    string  `json:"path"`
	Line    int     `json:"line"`
	Score   float32 `json:"score"`
	Snippet string  `json:"snippet"`
}

// Pending lists files that need (re-)indexing.
type Pending struct {
	Files    []PendingFile `json:"files"`
	Total    int           `json:"total"`    // indexable files in the folder
	Indexed  int           `json:"indexed"`  // files already up to date
	Passages int           `json:"passages"` // passages in the index
}

type PendingFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
	// Partial: the first passage is indexed, the rest isn't yet.
	Partial bool `json:"partial"`
}

// Put modes. Indexing runs in two passes so that every file becomes
// findable quickly: first one passage per file, then the remaining ones.
const (
	PutAll   = "all"   // replace the entry with all passages
	PutFirst = "first" // replace the entry with its first passage, mark it partial
	PutRest  = "rest"  // append the remaining passages to a partial entry
)

// Status describes the index of one folder.
type Status struct {
	Files    int   `json:"files"`
	Passages int   `json:"passages"`
	Bytes    int64 `json:"bytes"` // on disk
}

type fileEntry struct {
	Path     string    `json:"path"` // slash-separated, relative to the root
	Size     int64     `json:"size"`
	Mod      int64     `json:"mod"`
	Partial  bool      `json:"partial,omitempty"`
	Lines    []int     `json:"lines"`
	Snippets []string  `json:"snippets"`
	scales   []float32 // one per passage
	vecs     []int8    // Dims per passage
}

type index struct {
	root  string
	files map[string]*fileEntry
}

// Store keeps the index of one folder in memory (the folder that is open)
// and persists it under dir. It is safe for concurrent use.
type Store struct {
	dir string

	mu        sync.Mutex
	cur       *index
	dirty     bool
	lastSaved time.Time
}

// NewStore creates a store saving index files under dir.
func NewStore(dir string) *Store { return &Store{dir: dir} }

func (s *Store) fileFor(root string) string {
	h := sha256.Sum256([]byte(root))
	return filepath.Join(s.dir, hex.EncodeToString(h[:12])+".idx")
}

// load makes root the current index, saving the previous one. Caller holds mu.
func (s *Store) load(root string) *index {
	root = filepath.Clean(root)
	if s.cur != nil && s.cur.root == root {
		return s.cur
	}
	if s.cur != nil && s.dirty {
		s.saveLocked()
	}
	idx, err := readIndex(s.fileFor(root))
	if err != nil || idx.root != root {
		idx = &index{root: root, files: map[string]*fileEntry{}}
	}
	s.cur, s.dirty = idx, false
	return idx
}

func rel(root, p string) (string, bool) {
	r, err := filepath.Rel(root, p)
	if err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) || filepath.IsAbs(r) {
		return "", false
	}
	return filepath.ToSlash(r), true
}

// Pending walks root, drops index entries of deleted or changed files and
// returns the files that need embedding: files without any passage first,
// then partially indexed ones, smallest first within each group.
func (s *Store) Pending(root string) Pending {
	files := fs.WalkFiles(root, MaxFiles)
	type cand struct {
		abs, rel  string
		size, mod int64
	}
	var cands []cand
	for _, p := range files {
		st, err := os.Stat(p)
		if err != nil || !Indexable(p, st.Size()) {
			continue
		}
		r, ok := rel(root, p)
		if !ok {
			continue
		}
		cands = append(cands, cand{p, r, st.Size(), st.ModTime().UnixMilli()})
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := s.load(root)
	seen := make(map[string]bool, len(cands))
	var out Pending
	var partial []PendingFile
	for _, c := range cands {
		seen[c.rel] = true
		e := idx.files[c.rel]
		switch {
		case e != nil && e.Size == c.size && e.Mod == c.mod && !e.Partial:
			out.Indexed++
		case e != nil && e.Size == c.size && e.Mod == c.mod:
			out.Indexed++
			partial = append(partial, PendingFile{Path: c.abs, Size: c.size, Partial: true})
		default:
			out.Files = append(out.Files, PendingFile{Path: c.abs, Size: c.size})
		}
	}
	for r := range idx.files {
		if !seen[r] {
			delete(idx.files, r)
			s.dirty = true
		}
	}
	out.Total = len(cands)
	for _, e := range idx.files {
		out.Passages += len(e.Lines)
	}
	bySize := func(f []PendingFile) { sort.SliceStable(f, func(i, j int) bool { return f[i].Size < f[j].Size }) }
	bySize(out.Files)
	bySize(partial)
	out.Files = append(out.Files, partial...)
	return out
}

// Put stores the embedded passages of one file (see the Put modes). size/mod
// are the values ReadPassages saw, so a file changed meanwhile is picked up
// next time.
func (s *Store) Put(root, p string, size, mod int64, items []Item, mode string) error {
	r, ok := rel(filepath.Clean(root), p)
	if !ok {
		return fmt.Errorf("%s is outside %s", p, root)
	}
	e := &fileEntry{Path: r, Size: size, Mod: mod, Partial: mode == PutFirst}
	for _, it := range items {
		if len(it.Vector) != Model.Dims {
			return fmt.Errorf("vector has %d dimensions, expected %d", len(it.Vector), Model.Dims)
		}
		scale, q := quantize(it.Vector)
		e.Lines = append(e.Lines, it.Line)
		e.Snippets = append(e.Snippets, Snippet(it.Text, 220))
		e.scales = append(e.scales, scale)
		e.vecs = append(e.vecs, q...)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := s.load(root)
	switch mode {
	case PutAll, PutFirst:
		idx.files[r] = e
	case PutRest:
		old := idx.files[r]
		if old == nil || !old.Partial || old.Size != size || old.Mod != mod {
			return nil // changed meanwhile; the next pass starts it over
		}
		old.Partial = false
		old.Lines = append(old.Lines, e.Lines...)
		old.Snippets = append(old.Snippets, e.Snippets...)
		old.scales = append(old.scales, e.scales...)
		old.vecs = append(old.vecs, e.vecs...)
	default:
		return fmt.Errorf("unknown put mode %q", mode)
	}
	s.dirty = true
	if time.Since(s.lastSaved) > 10*time.Second {
		s.saveLocked()
	}
	return nil
}

// Query returns the best-matching files for an embedded query, one hit (the
// best passage) per file.
func (s *Store) Query(root string, q []float32, k int) ([]Hit, error) {
	if len(q) != Model.Dims {
		return nil, fmt.Errorf("query has %d dimensions, expected %d", len(q), Model.Dims)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := s.load(root)
	hits := make([]Hit, 0, len(idx.files))
	d := Model.Dims
	for _, e := range idx.files {
		best, bi := float32(-2), -1
		for i := range e.Lines {
			v := e.vecs[i*d : (i+1)*d]
			var dot float32
			for j, x := range v {
				dot += float32(x) * q[j]
			}
			if sc := dot * e.scales[i]; sc > best {
				best, bi = sc, i
			}
		}
		if bi >= 0 {
			hits = append(hits, Hit{Path: filepath.Join(idx.root, filepath.FromSlash(e.Path)), Line: e.Lines[bi], Score: best, Snippet: e.Snippets[bi]})
		}
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
	if len(hits) > k {
		hits = hits[:k]
	}
	return hits, nil
}

// Status reports the size of root's index.
func (s *Store) Status(root string) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := s.load(root)
	var st Status
	st.Files = len(idx.files)
	for _, e := range idx.files {
		st.Passages += len(e.Lines)
	}
	if fi, err := os.Stat(s.fileFor(idx.root)); err == nil {
		st.Bytes = fi.Size()
	}
	return st
}

// Flush writes the current index if it changed.
func (s *Store) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cur == nil || !s.dirty {
		return nil
	}
	return s.saveLocked()
}

// Unload saves and drops the in-memory index (to give memory back when the
// feature is turned off).
func (s *Store) Unload() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cur != nil && s.dirty {
		s.saveLocked()
	}
	s.cur, s.dirty = nil, false
}

// ClearAll deletes every index file.
func (s *Store) ClearAll() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cur, s.dirty = nil, false
	if s.dir == "" || !filepath.IsAbs(s.dir) {
		return errors.New("refusing to remove a relative index path")
	}
	return os.RemoveAll(s.dir)
}

func (s *Store) saveLocked() error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := writeIndex(&buf, s.cur); err != nil {
		return err
	}
	if err := fs.AtomicWriteFile(s.fileFor(s.cur.root), buf.Bytes()); err != nil {
		return err
	}
	s.dirty = false
	s.lastSaved = time.Now()
	return nil
}

func quantize(v []float32) (float32, []int8) {
	var m float64
	for _, x := range v {
		m = math.Max(m, math.Abs(float64(x)))
	}
	q := make([]int8, len(v))
	if m == 0 {
		return 0, q
	}
	scale := m / 127
	for i, x := range v {
		q[i] = int8(math.Round(float64(x) / scale))
	}
	return float32(scale), q
}

// File format (a cache; deleting it only means re-indexing):
//
//	"HIAIDX1\n", uint32 LE header length, JSON header
//	{"model","dims","root","files":[{path,size,mod,lines,snippets}]},
//	then for each file in header order, for each passage:
//	float32 LE scale + dims int8 values.
const magic = "HIAIDX1\n"

type header struct {
	Model string       `json:"model"`
	Dims  int          `json:"dims"`
	Root  string       `json:"root"`
	Files []*fileEntry `json:"files"`
}

func writeIndex(w io.Writer, idx *index) error {
	h := header{Model: Model.ID, Dims: Model.Dims, Root: idx.root}
	for _, e := range idx.files {
		h.Files = append(h.Files, e)
	}
	sort.Slice(h.Files, func(i, j int) bool { return h.Files[i].Path < h.Files[j].Path })
	hj, err := json.Marshal(h)
	if err != nil {
		return err
	}
	bw := bufio.NewWriter(w)
	bw.WriteString(magic)
	binary.Write(bw, binary.LittleEndian, uint32(len(hj)))
	bw.Write(hj)
	for _, e := range h.Files {
		for i := range e.Lines {
			binary.Write(bw, binary.LittleEndian, e.scales[i])
			v := e.vecs[i*h.Dims : (i+1)*h.Dims]
			b := make([]byte, len(v))
			for j, x := range v {
				b[j] = byte(x)
			}
			bw.Write(b)
		}
	}
	return bw.Flush()
}

func readIndex(p string) (*index, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	br := bufio.NewReader(f)
	m := make([]byte, len(magic))
	if _, err := io.ReadFull(br, m); err != nil || string(m) != magic {
		return nil, errors.New("not an index file")
	}
	var n uint32
	if err := binary.Read(br, binary.LittleEndian, &n); err != nil || n > 1<<30 {
		return nil, errors.New("bad index header")
	}
	hj := make([]byte, n)
	if _, err := io.ReadFull(br, hj); err != nil {
		return nil, err
	}
	var h header
	if err := json.Unmarshal(hj, &h); err != nil {
		return nil, err
	}
	if h.Model != Model.ID || h.Dims != Model.Dims {
		return nil, errors.New("index was built with another model")
	}
	idx := &index{root: h.Root, files: make(map[string]*fileEntry, len(h.Files))}
	b := make([]byte, h.Dims)
	for _, e := range h.Files {
		if len(e.Snippets) != len(e.Lines) || path.IsAbs(e.Path) {
			return nil, errors.New("bad index entry")
		}
		e.scales = make([]float32, len(e.Lines))
		e.vecs = make([]int8, len(e.Lines)*h.Dims)
		for i := range e.Lines {
			if err := binary.Read(br, binary.LittleEndian, &e.scales[i]); err != nil {
				return nil, err
			}
			if _, err := io.ReadFull(br, b); err != nil {
				return nil, err
			}
			for j, x := range b {
				e.vecs[i*h.Dims+j] = int8(x)
			}
		}
		idx.files[e.Path] = e
	}
	return idx, nil
}
