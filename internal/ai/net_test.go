package ai

import (
	"context"
	"os"
	"testing"
)

// TestDownloadRuntime fetches this platform's ONNX Runtime from NuGet with
// the app's own code (Range requests into the package, checksum) and runs a
// tiny model with it. Needs the network: HIA_AI_NET=1 (CI sets it).
func TestDownloadRuntime(t *testing.T) {
	if os.Getenv("HIA_AI_NET") != "1" {
		t.Skip("HIA_AI_NET not set")
	}
	s := Store{Dir: t.TempDir()}
	var last, total int64
	if err := s.Install(context.Background(), nil, Pack{ID: "none"}, func(d, n int64) { last, total = d, n }); err != nil {
		t.Fatal(err)
	}
	if !s.RuntimeInstalled() || last != total || total == 0 {
		t.Fatalf("installed %v, progress %d/%d", s.RuntimeInstalled(), last, total)
	}
	t.Logf("runtime: %d bytes transferred", total)
	t.Setenv("HIA_ORT_LIB", s.RuntimePath())
	TestRunTinyModel(t)
}
