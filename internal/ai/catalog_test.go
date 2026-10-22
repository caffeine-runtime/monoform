package ai

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// sparse makes a file of the given size without writing its bytes.
func sparse(t *testing.T, p string, size int64) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(size); err != nil {
		t.Fatal(err)
	}
	f.Close()
}

func TestStore(t *testing.T) {
	if !Supported() {
		t.Skip("no runtime for this platform")
	}
	s := Store{Dir: t.TempDir()}
	r, _ := platformRuntime()
	if s.Installed(Subject) || s.DownloadBytes(Subject) <= Subject.Files[0].Size {
		t.Fatalf("empty store: installed %v, download %d", s.Installed(Subject), s.DownloadBytes(Subject))
	}
	// The shared runtime is counted in each pack's download.
	if rt := s.RuntimeDownloadBytes(); rt <= 0 || s.DownloadBytes(Subject) != rt+Subject.Files[0].Transfer() {
		t.Errorf("runtime share %d of %d", rt, s.DownloadBytes(Subject))
	}
	sparse(t, s.RuntimePath(), r.Size)
	for _, f := range runtimeNotices {
		sparse(t, filepath.Join(s.runtimeDir(), f.name), f.Size)
	}
	if s.RuntimeDownloadBytes() != 0 {
		t.Errorf("runtime there: share %d", s.RuntimeDownloadBytes())
	}
	sparse(t, s.ModelPath(Subject, "birefnet-lite-1024.onnx"), Subject.Files[0].Size)
	if !s.Installed(Subject) || s.Installed(Eraser) {
		t.Errorf("installed: subject %v eraser %v", s.Installed(Subject), s.Installed(Eraser))
	}
	if s.DownloadBytes(Subject) != 0 {
		t.Errorf("nothing left to download, got %d", s.DownloadBytes(Subject))
	}
	// The runtime is already there: the eraser only needs its own files.
	var want int64
	for _, f := range Eraser.Files {
		want += f.Size
	}
	if got := s.DownloadBytes(Eraser); got != want {
		t.Errorf("eraser download %d, want %d", got, want)
	}
	for _, f := range Eraser.Files {
		sparse(t, s.ModelPath(Eraser, f.Name), f.Size)
	}
	// Removing one pack keeps the runtime for the other…
	if err := s.Remove(Subject); err != nil {
		t.Fatal(err)
	}
	if s.Installed(Subject) || !s.Installed(Eraser) || !s.RuntimeInstalled() {
		t.Error("removing the subject pack")
	}
	// …removing the last one removes it too.
	if err := s.Remove(Eraser); err != nil {
		t.Fatal(err)
	}
	if s.RuntimeInstalled() {
		t.Error("runtime left behind")
	}
	if _, err := (&Engine{Store: s}).SubjectMask(context.Background(), make([]byte, 3*SubjectSize*SubjectSize)); err != ErrNotInstalled {
		t.Errorf("not installed: %v", err)
	}
}

func TestSchedule(t *testing.T) {
	ac := alphasCumprod()
	// diffusers' scaled_linear schedule (beta 0.00085..0.012, 1000 steps).
	if math.Abs(ac[0]-0.99915) > 1e-6 || math.Abs(ac[999]-0.0046597) > 1e-6 {
		t.Errorf("ᾱ[0]=%v ᾱ[999]=%v", ac[0], ac[999])
	}
	ts := timesteps(5)
	if want := []int{999, 749, 500, 250, 0}; len(ts) != 5 || ts[0] != want[0] || ts[1] != want[1] || ts[2] != want[2] || ts[4] != 0 {
		t.Errorf("timesteps %v", ts)
	}
}
