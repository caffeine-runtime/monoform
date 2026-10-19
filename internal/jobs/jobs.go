// Package jobs runs long operations in the background with throttled
// progress reporting and cancellation. Every heavy backend operation (hashing,
// searching, extracting, PDF merges) goes through a Manager so the frontend
// can show one consistent progress UI.
package jobs

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// Emitter delivers events to the frontend (wraps runtime.EventsEmit).
type Emitter interface {
	Emit(event string, data any)
}

type EmitterFunc func(event string, data any)

func (f EmitterFunc) Emit(event string, data any) { f(event, data) }

const (
	EventProgress = "job:progress"
	EventData     = "job:data"
	EventDone     = "job:done"
)

// Progress is sent at most every Interval while a job runs.
type Progress struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Label   string `json:"label"`
	Done    int64  `json:"done"`
	Total   int64  `json:"total"` // 0 when unknown
	Message string `json:"message"`
}

// Data carries intermediate results (e.g. streamed search matches).
type Data struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Items any    `json:"items"`
}

// Done is sent exactly once per job.
type Done struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Result    any    `json:"result"`
	Error     string `json:"error"`
	Cancelled bool   `json:"cancelled"`
	Millis    int64  `json:"millis"`
}

// Interval is the maximum progress event rate. The budget is "at least every
// 250 ms"; we report a bit faster.
var Interval = 100 * time.Millisecond

type Func func(ctx context.Context, r *Reporter) (any, error)

type Manager struct {
	emit Emitter
	mu   sync.Mutex
	jobs map[string]context.CancelFunc
	seq  atomic.Int64
	wg   sync.WaitGroup
}

func NewManager(e Emitter) *Manager {
	return &Manager{emit: e, jobs: map[string]context.CancelFunc{}}
}

// Start runs fn in a goroutine and returns the job id immediately.
func (m *Manager) Start(kind, label string, fn Func) string {
	id := fmt.Sprintf("%s-%d", kind, m.seq.Add(1))
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.jobs[id] = cancel
	m.mu.Unlock()

	r := &Reporter{id: id, kind: kind, label: label, emit: m.emit}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		start := time.Now()
		var res any
		var err error
		func() {
			defer func() {
				if p := recover(); p != nil {
					err = fmt.Errorf("internal error: %v", p)
				}
			}()
			res, err = fn(ctx, r)
		}()
		r.flush()
		d := Done{ID: id, Kind: kind, Result: res, Millis: time.Since(start).Milliseconds()}
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				d.Cancelled = true
			}
			d.Error = err.Error()
		}
		m.mu.Lock()
		delete(m.jobs, id)
		m.mu.Unlock()
		cancel()
		m.emit.Emit(EventDone, d)
	}()
	return id
}

// Cancel requests cancellation; it returns false for unknown/finished jobs.
func (m *Manager) Cancel(id string) bool {
	m.mu.Lock()
	cancel, ok := m.jobs[id]
	m.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

// CancelAll cancels every running job (used on shutdown).
func (m *Manager) CancelAll() {
	m.mu.Lock()
	for _, c := range m.jobs {
		c()
	}
	m.mu.Unlock()
}

// Wait blocks until all jobs have finished (tests and shutdown).
func (m *Manager) Wait() { m.wg.Wait() }

// Reporter is handed to a job to report progress and stream data.
type Reporter struct {
	id, kind, label string
	emit            Emitter
	mu              sync.Mutex
	last            time.Time
	cur             Progress
	pending         bool
}

func (r *Reporter) ID() string { return r.id }

// Set records progress and emits it if Interval has passed since the last
// emission. Cheap enough to call per buffer.
func (r *Reporter) Set(done, total int64, message string) {
	r.mu.Lock()
	r.cur = Progress{ID: r.id, Kind: r.kind, Label: r.label, Done: done, Total: total, Message: message}
	now := time.Now()
	if now.Sub(r.last) < Interval {
		r.pending = true
		r.mu.Unlock()
		return
	}
	r.last = now
	r.pending = false
	p := r.cur
	r.mu.Unlock()
	r.emit.Emit(EventProgress, p)
}

// Send streams intermediate results to the frontend.
func (r *Reporter) Send(items any) {
	r.emit.Emit(EventData, Data{ID: r.id, Kind: r.kind, Items: items})
}

func (r *Reporter) flush() {
	r.mu.Lock()
	pending, p := r.pending, r.cur
	r.pending = false
	r.mu.Unlock()
	if pending {
		r.emit.Emit(EventProgress, p)
	}
}

// ProgressReader wraps a reader and reports bytes read.
type ProgressReader struct {
	R     interface{ Read([]byte) (int, error) }
	Ctx   context.Context
	Rep   *Reporter
	Total int64
	Base  int64 // bytes already done before this reader (multi-file jobs)
	Msg   string
	n     int64
}

func (p *ProgressReader) Read(b []byte) (int, error) {
	if err := p.Ctx.Err(); err != nil {
		return 0, err
	}
	n, err := p.R.Read(b)
	p.n += int64(n)
	if p.Rep != nil {
		p.Rep.Set(p.Base+p.n, p.Total, p.Msg)
	}
	return n, err
}

func (p *ProgressReader) N() int64 { return p.n }
