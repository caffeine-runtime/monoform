package fs

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// ChangeEvent is emitted when a watched file or directory changes on disk.
type ChangeEvent struct {
	Path string `json:"path"`
	Op   string `json:"op"`  // "write", "remove", "create", "rename"
	Dir  bool   `json:"dir"` // true when Path is a watched directory whose listing changed
}

// Watcher watches individual files (open tabs) and directories (expanded
// folders in the tree). It watches parent directories rather than files, so
// editors that save by replacing the file are still noticed. Changes caused
// by our own saves are suppressed via NoteOwnWrite.
type Watcher struct {
	w      *fsnotify.Watcher
	emit   func(ChangeEvent)
	mu     sync.Mutex
	files  map[string]int // watched file -> refcount
	dirs   map[string]int // watched listing dirs -> refcount
	parent map[string]int // directories registered with fsnotify -> refcount
	own    map[string]ownWrite
	timers map[string]*time.Timer
	done   chan struct{}
}

type ownWrite struct {
	size    int64
	modTime time.Time
	at      time.Time
}

// debounce collapses bursts (write + chmod + rename) into one event.
const debounce = 150 * time.Millisecond

func NewWatcher(emit func(ChangeEvent)) (*Watcher, error) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		w: fw, emit: emit,
		files: map[string]int{}, dirs: map[string]int{}, parent: map[string]int{},
		own: map[string]ownWrite{}, timers: map[string]*time.Timer{},
		done: make(chan struct{}),
	}
	go w.loop()
	return w, nil
}

func (w *Watcher) Close() error {
	close(w.done)
	return w.w.Close()
}

// WatchFile starts reporting changes to the file at p.
func (w *Watcher) WatchFile(p string) error {
	p = filepath.Clean(p)
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.addParent(filepath.Dir(p)); err != nil {
		return err
	}
	w.files[p]++
	return nil
}

func (w *Watcher) UnwatchFile(p string) {
	p = filepath.Clean(p)
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.files[p] == 0 {
		return
	}
	w.files[p]--
	if w.files[p] == 0 {
		delete(w.files, p)
	}
	w.removeParent(filepath.Dir(p))
}

// WatchDir reports listing changes (files added/removed/renamed) in dir.
func (w *Watcher) WatchDir(dir string) error {
	dir = filepath.Clean(dir)
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.addParent(dir); err != nil {
		return err
	}
	w.dirs[dir]++
	return nil
}

func (w *Watcher) UnwatchDir(dir string) {
	dir = filepath.Clean(dir)
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.dirs[dir] == 0 {
		return
	}
	w.dirs[dir]--
	if w.dirs[dir] == 0 {
		delete(w.dirs, dir)
	}
	w.removeParent(dir)
}

// NoteOwnWrite records the state of p right after we wrote it, so the
// resulting fsnotify events are not reported as external changes.
func (w *Watcher) NoteOwnWrite(p string) {
	p = filepath.Clean(p)
	st, err := os.Stat(p)
	if err != nil {
		return
	}
	w.mu.Lock()
	w.own[p] = ownWrite{size: st.Size(), modTime: st.ModTime(), at: time.Now()}
	w.mu.Unlock()
}

func (w *Watcher) addParent(dir string) error {
	if w.parent[dir] == 0 {
		if err := w.w.Add(dir); err != nil {
			return err
		}
	}
	w.parent[dir]++
	return nil
}

func (w *Watcher) removeParent(dir string) {
	if w.parent[dir] == 0 {
		return
	}
	w.parent[dir]--
	if w.parent[dir] == 0 {
		delete(w.parent, dir)
		w.w.Remove(dir)
	}
}

func (w *Watcher) loop() {
	for {
		select {
		case <-w.done:
			return
		case ev, ok := <-w.w.Events:
			if !ok {
				return
			}
			w.handle(ev)
		case _, ok := <-w.w.Errors:
			if !ok {
				return
			}
		}
	}
}

func opName(op fsnotify.Op) string {
	switch {
	case op.Has(fsnotify.Remove):
		return "remove"
	case op.Has(fsnotify.Rename):
		return "rename"
	case op.Has(fsnotify.Create):
		return "create"
	default:
		return "write"
	}
}

func (w *Watcher) handle(ev fsnotify.Event) {
	p := filepath.Clean(ev.Name)
	dir := filepath.Dir(p)
	op := opName(ev.Op)
	if ev.Op == fsnotify.Chmod {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.files[p] > 0 {
		w.schedule(p, ChangeEvent{Path: p, Op: op})
	}
	// Listing changes only matter for creates, removes and renames.
	if w.dirs[dir] > 0 && op != "write" {
		w.schedule(dir+"\x00dir", ChangeEvent{Path: dir, Op: op, Dir: true})
	}
}

// schedule debounces events per key; must hold w.mu.
func (w *Watcher) schedule(key string, ev ChangeEvent) {
	if t, ok := w.timers[key]; ok {
		t.Stop()
	}
	w.timers[key] = time.AfterFunc(debounce, func() {
		w.mu.Lock()
		delete(w.timers, key)
		if !ev.Dir && w.isOwnWrite(ev.Path) {
			w.mu.Unlock()
			return
		}
		w.mu.Unlock()
		w.emit(ev)
	})
}

// isOwnWrite reports whether the file still matches what we last wrote;
// must hold w.mu.
func (w *Watcher) isOwnWrite(p string) bool {
	o, ok := w.own[p]
	if !ok {
		return false
	}
	if time.Since(o.at) > 10*time.Second {
		delete(w.own, p)
		return false
	}
	st, err := os.Stat(p)
	if err != nil {
		return false
	}
	return st.Size() == o.size && st.ModTime().Equal(o.modTime)
}
