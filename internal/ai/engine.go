package ai

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Engine runs the packs' models: a model is loaded on first use and freed
// after IdleAfter without use, so nothing stays in memory (or runs) unless
// the user is using the feature. One inference runs at a time.
type Engine struct {
	Store     Store
	IdleAfter time.Duration
	// Threads per inference (0: ONNX Runtime's default, the physical cores).
	Threads int

	mu       sync.Mutex
	sessions map[string]*Session
	idle     *time.Timer
	run      sync.Mutex
}

// ErrNotInstalled means the pack's files aren't downloaded.
var ErrNotInstalled = errors.New("the model isn't installed")

// session loads (or reuses) one model file of a pack.
func (e *Engine) session(p Pack, name string) (*Session, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.idle != nil {
		e.idle.Stop()
	}
	path := e.Store.ModelPath(p, name)
	if s := e.sessions[path]; s != nil {
		return s, nil
	}
	if !e.Store.Installed(p) {
		return nil, ErrNotInstalled
	}
	rt, err := LoadRuntime(e.Store.RuntimePath())
	if err != nil {
		return nil, err
	}
	s, err := rt.Open(path, e.Threads)
	if err != nil {
		return nil, err
	}
	if e.sessions == nil {
		e.sessions = map[string]*Session{}
	}
	e.sessions[path] = s
	return s, nil
}

// done arms the idle timer after a use.
func (e *Engine) done() {
	e.mu.Lock()
	defer e.mu.Unlock()
	d := e.IdleAfter
	if d <= 0 {
		d = time.Minute
	}
	if e.idle != nil {
		e.idle.Stop()
	}
	e.idle = time.AfterFunc(d, e.Unload)
}

// Unload frees every loaded model (waits for a running inference).
func (e *Engine) Unload() {
	e.run.Lock()
	defer e.run.Unlock()
	e.mu.Lock()
	defer e.mu.Unlock()
	for k, s := range e.sessions {
		s.Close()
		delete(e.sessions, k)
	}
}

// Loaded reports how many models are in memory.
func (e *Engine) Loaded() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.sessions)
}

// begin serialises inferences and wires ctx to a Stop.
func (e *Engine) begin(ctx context.Context) (*Stop, func()) {
	e.run.Lock()
	stop := &Stop{}
	quit := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			stop.Terminate()
		case <-quit:
		}
	}()
	return stop, func() {
		close(quit)
		e.run.Unlock()
		e.done()
	}
}

func cancelled(ctx context.Context, err error) error {
	if errors.Is(err, errCancelled) || ctx.Err() != nil {
		return context.Canceled
	}
	return err
}
