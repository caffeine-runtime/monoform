package ai

import (
	"os"
	"path/filepath"
	"testing"
)

// The native runtime isn't in the repository: MF_ORT_LIB points at an
// onnxruntime shared library (CI downloads one with the app's own code, see
// TestDownloadRuntime).
func runtimeForTest(t *testing.T) *Runtime {
	t.Helper()
	lib := os.Getenv("MF_ORT_LIB")
	if lib == "" {
		t.Skip("MF_ORT_LIB not set")
	}
	rt, err := LoadRuntime(lib)
	if err != nil {
		t.Fatal(err)
	}
	return rt
}

func TestRunTinyModel(t *testing.T) {
	rt := runtimeForTest(t)
	s, err := rt.Open("testdata/tiny.onnx", 1)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	out, err := s.Run(map[string]Tensor{
		"x": {Shape: []int64{2, 3}, Float32: []float32{1, 2, 3, 4, 5, 6}},
		"k": {Shape: []int64{1}, Int64: []int64{10}},
	}, []string{"y"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	y := out["y"]
	if len(y.Shape) != 2 || y.Shape[0] != 2 || y.Shape[1] != 3 {
		t.Fatalf("shape %v", y.Shape)
	}
	for i, v := range y.Float32 {
		if want := float32(i+1)*2 + 10; v != want {
			t.Errorf("y[%d] = %v, want %v", i, v, want)
		}
	}
	// Errors come back as Go errors.
	if _, err := s.Run(map[string]Tensor{"x": {Shape: []int64{1, 3}, Float32: []float32{1, 2, 3}}, "k": {Shape: []int64{1}, Int64: []int64{1}}}, []string{"y"}, nil); err == nil {
		t.Error("wrong shape accepted")
	}
	if _, err := rt.Open("testdata/missing.onnx", 1); err == nil {
		t.Error("missing model opened")
	}
	// Paths outside ASCII (Windows takes them as UTF-16).
	data, _ := os.ReadFile("testdata/tiny.onnx")
	dir := filepath.Join(t.TempDir(), "modele zażółć 模型")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "tiny.onnx"), data, 0o644)
	if s2, err := rt.Open(filepath.Join(dir, "tiny.onnx"), 1); err != nil {
		t.Errorf("non-ASCII path: %v", err)
	} else {
		s2.Close()
	}
	// A terminated run stops with errCancelled.
	stop := &Stop{}
	stop.Terminate()
	if _, err := s.Run(map[string]Tensor{"x": {Shape: []int64{2, 3}, Float32: make([]float32, 6)}, "k": {Shape: []int64{1}, Int64: []int64{0}}}, []string{"y"}, stop); err != errCancelled {
		t.Errorf("stopped run: %v", err)
	}
}
