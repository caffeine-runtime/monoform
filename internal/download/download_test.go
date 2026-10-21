package download

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func TestFetchPlainAndZipMember(t *testing.T) {
	big := bytes.Repeat([]byte("hold it all "), 50000)
	var zb bytes.Buffer
	zw := zip.NewWriter(&zb)
	w, _ := zw.Create("runtimes/linux-x64/native/lib.so")
	w.Write(big)
	w2, _ := zw.CreateHeader(&zip.FileHeader{Name: "LICENSE", Method: zip.Store})
	w2.Write([]byte("MIT"))
	zw.Close()
	pkg := zb.Bytes()
	zr, _ := zip.NewReader(bytes.NewReader(pkg), int64(len(pkg)))
	member := func(name string) *ZipMember {
		for _, f := range zr.File {
			if f.Name == name {
				off, _ := f.DataOffset()
				// The header offset is where the local header starts: 30 bytes + name + extra before the data.
				return &ZipMember{HeaderOffset: off - 30 - int64(len(f.Name)) - int64(len(f.Extra)), CompressedSize: int64(f.CompressedSize64), Method: f.Method}
			}
		}
		t.Fatalf("no %s", name)
		return nil
	}
	var ranges []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ranges = append(ranges, r.Header.Get("Range"))
		switch r.URL.Path {
		case "/pkg.nupkg":
			http.ServeContent(w, r, "pkg", time.Time{}, bytes.NewReader(pkg))
		case "/model.onnx":
			w.Write(big)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	dir := t.TempDir()

	// A plain file.
	f := File{URL: srv.URL + "/model.onnx", Size: int64(len(big)), SHA256: sum(big)}
	var last int64
	if err := Fetch(context.Background(), nil, filepath.Join(dir, "m", "model.onnx"), f, func(n int64) { last = n }); err != nil {
		t.Fatal(err)
	}
	if !Present(filepath.Join(dir, "m", "model.onnx"), f) || last != f.Size {
		t.Errorf("plain: present %v, progress %d", Present(filepath.Join(dir, "m", "model.onnx"), f), last)
	}

	// A deflated zip member: only its bytes are fetched, with Range.
	ranges = nil
	lib := File{URL: srv.URL + "/pkg.nupkg", Size: int64(len(big)), SHA256: sum(big), Zip: member("runtimes/linux-x64/native/lib.so")}
	if lib.Transfer() >= lib.Size {
		t.Errorf("compressed %d not smaller than %d", lib.Transfer(), lib.Size)
	}
	if err := Fetch(context.Background(), nil, filepath.Join(dir, "lib.so"), lib, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "lib.so")); !bytes.Equal(got, big) {
		t.Error("member contents differ")
	}
	if len(ranges) != 2 || !strings.HasPrefix(ranges[0], "bytes=") {
		t.Errorf("ranges %v", ranges)
	}
	// A stored member.
	lic := File{URL: srv.URL + "/pkg.nupkg", Size: 3, SHA256: sum([]byte("MIT")), Zip: member("LICENSE")}
	if err := Fetch(context.Background(), nil, filepath.Join(dir, "LICENSE"), lic, nil); err != nil {
		t.Fatal(err)
	}

	// A wrong checksum leaves nothing behind.
	bad := f
	bad.SHA256 = strings.Repeat("0", 64)
	if err := Fetch(context.Background(), nil, filepath.Join(dir, "bad.onnx"), bad, nil); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Errorf("bad checksum: %v", err)
	}
	// A wrong size too.
	short := f
	short.Size--
	if err := Fetch(context.Background(), nil, filepath.Join(dir, "short.onnx"), short, nil); err == nil {
		t.Error("oversized download accepted")
	}
	// Missing on the server.
	if err := Fetch(context.Background(), nil, filepath.Join(dir, "x"), File{URL: srv.URL + "/nope", Size: 1, SHA256: sum([]byte("x"))}, nil); err == nil {
		t.Error("404 accepted")
	}
	// Cancelled.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Fetch(ctx, nil, filepath.Join(dir, "c.onnx"), f, nil); err == nil {
		t.Error("cancelled download succeeded")
	}
	left, _ := filepath.Glob(filepath.Join(dir, ".part-*"))
	if _, err := os.Stat(filepath.Join(dir, "bad.onnx")); err == nil || len(left) != 0 {
		t.Errorf("leftovers: %v", left)
	}
}
