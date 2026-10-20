// Package history keeps earlier versions of the files the app saves, so any
// of them can be looked at, compared or restored. It is told about every
// replace (internal/fs calls Before and After around the rename):
//
//   - Before: the content about to be replaced is kept. It is hardlinked into
//     the store when possible (the rename then leaves that copy as the only
//     name of the old content — no bytes copied on the save path) and copied
//     otherwise.
//   - After: the new content is copied, so a version saved here survives even
//     if another program later overwrites the file.
//
// Contents are stored once per SHA-256 (gzip for compressible formats); each
// file has a small JSON index of its versions. Old versions are dropped past a
// per-file count and a total size, oldest first, never a file's newest one.
package history

import (
	"compress/gzip"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// Version kinds.
const (
	KindOriginal = "original" // the content before the app first saved the file
	KindOutside  = "outside"  // changed by another program since the last save here
	KindSaved    = "saved"
	KindRestored = "restored"
)

// Entry is one kept version.
type Entry struct {
	Time int64  `json:"t"` // unix ms when it was recorded
	Hash string `json:"h"`
	Size int64  `json:"s"`
	Kind string `json:"k"`
	Note string `json:"n,omitempty"`
}

// File is the history of one path, newest version first.
type File struct {
	Path    string  `json:"path"`
	Exists  bool    `json:"exists"`
	Current string  `json:"current,omitempty"` // hash of the file as it is now
	Entries []Entry `json:"entries"`
}

// Summary describes a file with history (for the list of all files).
type Summary struct {
	Path     string `json:"path"`
	Exists   bool   `json:"exists"`
	Versions int    `json:"versions"`
	Last     int64  `json:"last"`
	Bytes    int64  `json:"bytes"` // stored size of its versions (shared contents counted per file)
}

// Limits bound what is kept.
type Limits struct {
	MaxFileBytes int64 // larger files aren't versioned
	MaxTotal     int64 // all stored contents together
	MaxPerFile   int   // versions per file
}

// DefaultLimits are used when settings give none.
var DefaultLimits = Limits{MaxFileBytes: 256 << 20, MaxTotal: 2 << 30, MaxPerFile: 100}

type job struct {
	path string // the versioned file
	src  string // its pinned content (a link or copy in pending/)
	kind string // "before" or "after"
	at   int64
}

// Store is the history in one directory.
type Store struct {
	dir     string
	exclude []string // folders whose files are never versioned (the app's own data)
	// Skip, if set, also keeps files out of history (checked with the absolute path).
	Skip func(abs string) bool

	cfgMu   sync.Mutex // settings, checked on the save path
	limits  Limits
	enabled bool
	closed  bool

	mu    sync.Mutex        // index files, contents, notes
	notes map[string]string // path → note for its next "after" (restores)
	usage int64             // bytes of kept contents; -1 until measured

	jobs     chan job
	pending  sync.WaitGroup
	closeErr sync.Once
	now      func() time.Time
}

// Open opens (creating) a store in dir. Files under exclude are ignored.
func Open(dir string, exclude ...string) (*Store, error) {
	for _, d := range []string{"blobs", "index", "pending"} {
		if err := os.MkdirAll(filepath.Join(dir, d), 0o755); err != nil {
			return nil, err
		}
	}
	// Leftovers from a run that ended mid-save.
	if des, err := os.ReadDir(filepath.Join(dir, "pending")); err == nil {
		for _, d := range des {
			os.Remove(filepath.Join(dir, "pending", d.Name()))
		}
	}
	var ex []string
	for _, e := range append([]string{dir}, exclude...) {
		if e == "" {
			continue
		}
		e, _ = filepath.Abs(e)
		ex = append(ex, filepath.Clean(e))
		// Saves resolve symlinks (macOS: /var → /private/var), so match both forms.
		if r, err := filepath.EvalSymlinks(e); err == nil && r != e {
			ex = append(ex, r)
		}
	}
	s := &Store{dir: dir, exclude: ex, limits: DefaultLimits, enabled: true, notes: map[string]string{}, usage: -1, jobs: make(chan job, 256), now: time.Now}
	go s.loop()
	return s, nil
}

// Configure sets whether new versions are recorded and the limits.
func (s *Store) Configure(enabled bool, l Limits) {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	s.enabled = enabled
	if l.MaxFileBytes <= 0 {
		l.MaxFileBytes = DefaultLimits.MaxFileBytes
	}
	if l.MaxTotal <= 0 {
		l.MaxTotal = DefaultLimits.MaxTotal
	}
	if l.MaxPerFile <= 0 {
		l.MaxPerFile = DefaultLimits.MaxPerFile
	}
	s.limits = l
}

// Close finishes queued work.
func (s *Store) Close() {
	s.Flush()
	s.closeErr.Do(func() {
		s.cfgMu.Lock()
		s.closed = true
		s.cfgMu.Unlock()
		close(s.jobs)
	})
}

// Flush waits until every recorded save is in the index.
func (s *Store) Flush() { s.pending.Wait() }

func (s *Store) tracked(path string) (string, os.FileInfo, bool) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", nil, false
	}
	for _, e := range s.exclude {
		if abs == e || strings.HasPrefix(abs, e+string(filepath.Separator)) {
			return "", nil, false
		}
	}
	if s.Skip != nil && s.Skip(abs) {
		return "", nil, false
	}
	st, err := os.Stat(abs)
	if err != nil || !st.Mode().IsRegular() {
		return "", nil, false
	}
	s.cfgMu.Lock()
	ok := s.enabled && !s.closed && st.Size() <= s.limits.MaxFileBytes
	s.cfgMu.Unlock()
	return abs, st, ok
}

// Before keeps the content of path, which is about to be replaced.
func (s *Store) Before(path string) { s.take(path, "before") }

// After records the new content of path.
func (s *Store) After(path string) { s.take(path, "after") }

// take pins the current content of path for the background worker, now, so
// versions stay in save order. The content about to be replaced is hard
// linked (free: after the rename that link is its only name); a new content
// is copied, since another program may still rewrite the file in place.
func (s *Store) take(path, kind string) {
	abs, _, ok := s.tracked(path)
	if !ok {
		return
	}
	tmp := filepath.Join(s.dir, "pending", randName())
	var err error
	if kind == "before" {
		err = os.Link(abs, tmp)
	}
	if kind != "before" || err != nil {
		err = copyFile(abs, tmp)
	}
	if err != nil {
		os.Remove(tmp)
		return
	}
	s.queue(job{path: abs, src: tmp, kind: kind})
}

func (s *Store) queue(j job) {
	j.at = s.now().UnixMilli()
	s.pending.Add(1)
	s.jobs <- j
}

func (s *Store) loop() {
	for j := range s.jobs {
		s.ingest(j)
		os.Remove(j.src)
		s.pending.Done()
	}
}

func (s *Store) ingest(j job) {
	s.mu.Lock()
	defer s.mu.Unlock()
	hash, size, err := s.store(j.src, j.path)
	if err != nil {
		return
	}
	f := s.readIndex(j.path)
	last := ""
	if len(f.Entries) > 0 {
		last = f.Entries[0].Hash
	}
	if hash == last {
		if j.kind == "after" {
			delete(s.notes, j.path)
		}
		return // nothing new (a save that didn't change anything, or the content we already have)
	}
	e := Entry{Time: j.at, Hash: hash, Size: size}
	switch {
	case j.kind == "after" && s.notes[j.path] != "":
		e.Kind, e.Note = KindRestored, s.notes[j.path]
		delete(s.notes, j.path)
	case j.kind == "after":
		e.Kind = KindSaved
	case len(f.Entries) == 0:
		e.Kind = KindOriginal
	default:
		e.Kind = KindOutside
	}
	f.Entries = append([]Entry{e}, f.Entries...)
	lim := s.config()
	trimmed := len(f.Entries) > lim.MaxPerFile
	if trimmed {
		f.Entries = f.Entries[:lim.MaxPerFile]
	}
	s.writeIndex(f)
	if trimmed {
		s.gcLocked()
	}
	s.pruneLocked(lim.MaxTotal)
}

func (s *Store) config() Limits {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	return s.limits
}

// store copies a content into blobs (once per hash); name gives its type.
func (s *Store) store(src, name string) (string, int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return "", 0, err
	}
	defer in.Close()
	h := sha256.New()
	size, err := io.Copy(h, in)
	if err != nil {
		return "", 0, err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	if s.blobPath(sum) != "" {
		return sum, size, nil
	}
	if _, err := in.Seek(0, io.SeekStart); err != nil {
		return "", 0, err
	}
	dir := filepath.Join(s.dir, "blobs", sum[:2])
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, err
	}
	dst := filepath.Join(dir, sum)
	gz := !packed[strings.ToLower(filepath.Ext(name))]
	if gz {
		dst += ".gz"
	}
	tmp := dst + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return "", 0, err
	}
	var w io.Writer = out
	var zw *gzip.Writer
	if gz {
		zw, _ = gzip.NewWriterLevel(out, gzip.BestSpeed)
		w = zw
	}
	_, err = io.Copy(w, in)
	if zw != nil && err == nil {
		err = zw.Close()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, dst)
	}
	if err != nil {
		os.Remove(tmp)
		return "", 0, err
	}
	if s.usage >= 0 {
		if st, err := os.Stat(dst); err == nil {
			s.usage += st.Size()
		}
	}
	return sum, size, nil
}

func (s *Store) blobPath(hash string) string {
	if len(hash) < 3 || strings.ContainsAny(hash, `/\.`) {
		return ""
	}
	base := filepath.Join(s.dir, "blobs", hash[:2], hash)
	for _, p := range []string{base, base + ".gz"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// OpenVersion reads a kept version.
func (s *Store) OpenVersion(hash string) (io.ReadCloser, error) {
	p := s.blobPath(hash)
	if p == "" {
		return nil, os.ErrNotExist
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(p, ".gz") {
		return f, nil
	}
	zr, err := gzip.NewReader(f)
	if err != nil {
		f.Close()
		return nil, err
	}
	return readCloser{zr, f}, nil
}

type readCloser struct {
	io.Reader
	f *os.File
}

func (r readCloser) Close() error { return r.f.Close() }

// History returns the versions of path, newest first (after pending saves).
func (s *Store) History(path string) File {
	s.Flush()
	abs, _ := filepath.Abs(path)
	s.mu.Lock()
	f := s.readIndex(abs)
	s.mu.Unlock()
	if f.Entries == nil {
		f.Entries = []Entry{}
	}
	st, err := os.Stat(abs)
	f.Exists = err == nil
	if err == nil && st.Mode().IsRegular() && st.Size() <= s.config().MaxFileBytes {
		f.Current = hashFile(abs)
	}
	return f
}

func hashFile(p string) string {
	in, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer in.Close()
	h := sha256.New()
	if _, err := io.Copy(h, in); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Files lists every file with history, most recently changed first.
func (s *Store) Files() []Summary {
	s.Flush()
	s.mu.Lock()
	all := s.allIndexes()
	s.mu.Unlock()
	out := make([]Summary, 0, len(all))
	for _, f := range all {
		if len(f.Entries) == 0 {
			continue
		}
		sm := Summary{Path: f.Path, Versions: len(f.Entries), Last: f.Entries[0].Time}
		for _, e := range f.Entries {
			sm.Bytes += e.Size
		}
		_, err := os.Stat(f.Path)
		sm.Exists = err == nil
		out = append(out, sm)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Last > out[j].Last })
	return out
}

// Restore writes a kept version back to path through write (which replaces
// the file atomically, so its current content becomes a version too).
func (s *Store) Restore(path, hash string, write func(path string, r io.Reader) error) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	f := s.History(abs)
	var from *Entry
	for i := range f.Entries {
		if f.Entries[i].Hash == hash {
			from = &f.Entries[i]
			break
		}
	}
	if from == nil {
		return errors.New("that version is no longer kept")
	}
	rc, err := s.OpenVersion(hash)
	if err != nil {
		return err
	}
	defer rc.Close()
	s.mu.Lock()
	s.notes[abs] = time.UnixMilli(from.Time).Format(time.RFC3339)
	s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	if err := write(abs, rc); err != nil {
		s.mu.Lock()
		delete(s.notes, abs)
		s.mu.Unlock()
		return err
	}
	s.Flush()
	return nil
}

// Moved carries the history of a renamed file or folder to its new path.
func (s *Store) Moved(from, to string) {
	s.Flush()
	from, _ = filepath.Abs(from)
	to, _ = filepath.Abs(to)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range s.allIndexes() {
		var np string
		switch {
		case f.Path == from:
			np = to
		case strings.HasPrefix(f.Path, from+string(filepath.Separator)):
			np = to + f.Path[len(from):]
		default:
			continue
		}
		os.Remove(s.indexPath(f.Path))
		old := s.readIndex(np) // a file that already had history at the new path keeps it, after these
		f.Path = np
		f.Entries = append(f.Entries, old.Entries...)
		sort.SliceStable(f.Entries, func(i, j int) bool { return f.Entries[i].Time > f.Entries[j].Time })
		s.writeIndex(f)
	}
}

// Forget drops the history of one file ("" drops everything).
func (s *Store) Forget(path string) {
	s.Flush()
	s.mu.Lock()
	defer s.mu.Unlock()
	if path == "" {
		os.RemoveAll(filepath.Join(s.dir, "index"))
		os.RemoveAll(filepath.Join(s.dir, "blobs"))
		os.MkdirAll(filepath.Join(s.dir, "index"), 0o755)
		os.MkdirAll(filepath.Join(s.dir, "blobs"), 0o755)
		s.usage = 0
		return
	}
	abs, _ := filepath.Abs(path)
	os.Remove(s.indexPath(abs))
	s.gcLocked()
}

// Usage is the size of all kept contents on disk.
func (s *Store) Usage() int64 {
	s.Flush()
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usageLocked()
}

func (s *Store) usageLocked() int64 {
	if s.usage < 0 {
		var n int64
		filepath.WalkDir(filepath.Join(s.dir, "blobs"), func(_ string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() {
				if info, err := d.Info(); err == nil {
					n += info.Size()
				}
			}
			return nil
		})
		s.usage = n
	}
	return s.usage
}

// pruneLocked drops the oldest versions (never a file's newest) until the
// kept contents fit in max bytes.
func (s *Store) pruneLocked(max int64) {
	if s.usageLocked() <= max {
		return
	}
	all := s.allIndexes()
	type ref struct {
		file int
		time int64
	}
	var old []ref
	for i, f := range all {
		for _, e := range f.Entries[min(1, len(f.Entries)):] {
			old = append(old, ref{i, e.Time})
		}
	}
	sort.Slice(old, func(i, j int) bool { return old[i].time < old[j].time })
	// Drop in batches: freeing space needs the indexes rewritten and the
	// contents nobody refers to any more removed.
	for len(old) > 0 && s.usageLocked() > max {
		n := min(16, len(old))
		drop := map[int]map[int64]bool{}
		for _, r := range old[:n] {
			if drop[r.file] == nil {
				drop[r.file] = map[int64]bool{}
			}
			drop[r.file][r.time] = true
		}
		old = old[n:]
		for fi, times := range drop {
			kept := all[fi].Entries[:0]
			for _, e := range all[fi].Entries {
				if !times[e.Time] {
					kept = append(kept, e)
				}
			}
			all[fi].Entries = kept
			s.writeIndex(all[fi])
		}
		s.gcLocked()
	}
}

// gcLocked removes contents no index refers to.
func (s *Store) gcLocked() {
	used := map[string]bool{}
	for _, f := range s.allIndexes() {
		for _, e := range f.Entries {
			used[e.Hash] = true
		}
	}
	filepath.WalkDir(filepath.Join(s.dir, "blobs"), func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		name := strings.TrimSuffix(strings.TrimSuffix(d.Name(), ".tmp"), ".gz")
		if used[name] {
			return nil
		}
		if info, err := d.Info(); err == nil && os.Remove(p) == nil && s.usage >= 0 {
			s.usage -= info.Size()
		}
		return nil
	})
}

func (s *Store) indexPath(abs string) string {
	key := abs
	if isCaseInsensitive() {
		key = strings.ToLower(key)
	}
	sum := sha1.Sum([]byte(key))
	return filepath.Join(s.dir, "index", hex.EncodeToString(sum[:12])+".json")
}

func (s *Store) readIndex(abs string) File {
	f := File{Path: abs}
	if b, err := os.ReadFile(s.indexPath(abs)); err == nil {
		var got File
		if json.Unmarshal(b, &got) == nil {
			f.Entries = got.Entries
		}
	}
	return f
}

func (s *Store) writeIndex(f File) {
	p := s.indexPath(f.Path)
	if len(f.Entries) == 0 {
		os.Remove(p)
		return
	}
	b, _ := json.Marshal(struct {
		Path    string  `json:"path"`
		Entries []Entry `json:"entries"`
	}{f.Path, f.Entries})
	tmp := p + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, p)
	}
}

func (s *Store) allIndexes() []File {
	des, _ := os.ReadDir(filepath.Join(s.dir, "index"))
	out := make([]File, 0, len(des))
	for _, d := range des {
		if !strings.HasSuffix(d.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, "index", d.Name()))
		if err != nil {
			continue
		}
		var f File
		if json.Unmarshal(b, &f) == nil && f.Path != "" {
			out = append(out, f)
		}
	}
	return out
}

// Formats that are already compressed gain nothing from gzip.
var packed = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".heic": true, ".heif": true, ".avif": true,
	".mp3": true, ".m4a": true, ".aac": true, ".ogg": true, ".opus": true, ".flac": true, ".mp4": true, ".m4v": true,
	".mov": true, ".webm": true, ".mkv": true, ".zip": true, ".gz": true, ".tgz": true, ".bz2": true, ".xz": true,
	".zst": true, ".7z": true, ".rar": true, ".jar": true, ".apk": true, ".docx": true, ".xlsx": true, ".pptx": true,
	".odt": true, ".ods": true, ".odp": true, ".epub": true, ".woff": true, ".woff2": true, ".glb": true, ".pdf": true,
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func randName() string {
	var b [8]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Windows and macOS file names are case-insensitive: one history per file.
func isCaseInsensitive() bool { return runtime.GOOS == "windows" || runtime.GOOS == "darwin" }
