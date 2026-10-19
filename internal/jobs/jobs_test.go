package jobs

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type recorder struct {
	mu     sync.Mutex
	events []string
	data   []any
	done   chan Done
}

func newRecorder() *recorder { return &recorder{done: make(chan Done, 4)} }

func (r *recorder) Emit(event string, data any) {
	r.mu.Lock()
	r.events = append(r.events, event)
	r.data = append(r.data, data)
	r.mu.Unlock()
	if d, ok := data.(Done); ok {
		r.done <- d
	}
}

func (r *recorder) count(ev string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, e := range r.events {
		if e == ev {
			n++
		}
	}
	return n
}

func TestJobCompletes(t *testing.T) {
	rec := newRecorder()
	m := NewManager(rec)
	id := m.Start("test", "Test", func(ctx context.Context, r *Reporter) (any, error) {
		r.Set(1, 2, "half")
		r.Send([]int{1, 2})
		return "ok", nil
	})
	d := <-rec.done
	if d.ID != id || d.Result != "ok" || d.Error != "" || d.Cancelled {
		t.Fatalf("done = %+v", d)
	}
	if rec.count(EventData) != 1 || rec.count(EventProgress) < 1 {
		t.Fatalf("events = %v", rec.events)
	}
	if !strings.HasPrefix(id, "test-") {
		t.Fatalf("id = %s", id)
	}
}

func TestJobCancel(t *testing.T) {
	rec := newRecorder()
	m := NewManager(rec)
	started := make(chan struct{})
	id := m.Start("slow", "Slow", func(ctx context.Context, r *Reporter) (any, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	})
	<-started
	if !m.Cancel(id) {
		t.Fatal("cancel returned false")
	}
	select {
	case d := <-rec.done:
		if !d.Cancelled {
			t.Fatalf("not cancelled: %+v", d)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}
	if m.Cancel(id) {
		t.Fatal("finished job should not be cancellable")
	}
}

func TestJobErrorAndPanic(t *testing.T) {
	rec := newRecorder()
	m := NewManager(rec)
	m.Start("e", "E", func(ctx context.Context, r *Reporter) (any, error) { return nil, errors.New("bad") })
	if d := <-rec.done; d.Error != "bad" || d.Cancelled {
		t.Fatalf("done = %+v", d)
	}
	m.Start("p", "P", func(ctx context.Context, r *Reporter) (any, error) { panic("oops") })
	if d := <-rec.done; !strings.Contains(d.Error, "oops") {
		t.Fatalf("done = %+v", d)
	}
}

func TestProgressThrottled(t *testing.T) {
	rec := newRecorder()
	m := NewManager(rec)
	m.Start("t", "T", func(ctx context.Context, r *Reporter) (any, error) {
		for i := 0; i < 100000; i++ {
			r.Set(int64(i), 100000, "")
		}
		return nil, nil
	})
	<-rec.done
	// A tight loop finishes in well under a second: only a handful of events.
	if n := rec.count(EventProgress); n < 1 || n > 20 {
		t.Fatalf("progress events = %d", n)
	}
	// The last progress event must carry the final value.
	rec.mu.Lock()
	var last Progress
	for i, e := range rec.events {
		if e == EventProgress {
			last = rec.data[i].(Progress)
		}
	}
	rec.mu.Unlock()
	if last.Done != 99999 {
		t.Fatalf("final progress = %+v", last)
	}
}

func TestProgressReader(t *testing.T) {
	rec := newRecorder()
	r := &Reporter{id: "x", emit: rec}
	pr := &ProgressReader{R: strings.NewReader("hello"), Ctx: context.Background(), Rep: r, Total: 5}
	buf := make([]byte, 10)
	n, _ := pr.Read(buf)
	if n != 5 || pr.N() != 5 {
		t.Fatal("bad read")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	pr2 := &ProgressReader{R: strings.NewReader("x"), Ctx: ctx}
	if _, err := pr2.Read(buf); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
}
