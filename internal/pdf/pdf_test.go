package pdf

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

func write(t *testing.T, dir, name string, pages int) string {
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, Minimal(pages), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// pageTexts returns the "Page N" label of each page, in order.
func pageTexts(t *testing.T, path string) []string {
	t.Helper()
	dir := t.TempDir()
	ctx := context.Background()
	if err := api.ExtractContentFile(ctx, path, dir, nil, conf()); err != nil {
		t.Fatal(err)
	}
	n, _ := PageCount(ctx, path)
	out := make([]string, n)
	files, _ := os.ReadDir(dir)
	for _, f := range files {
		b, _ := os.ReadFile(filepath.Join(dir, f.Name()))
		var page int
		// file names end in _Content_page_<n>.txt
		if i := strings.LastIndex(f.Name(), "_"); i >= 0 {
			page = atoi(strings.TrimSuffix(f.Name()[i+1:], ".txt"))
		}
		s := string(b)
		if i := strings.Index(s, "(Page "); i >= 0 && page >= 1 && page <= n {
			out[page-1] = s[i+1 : i+1+strings.Index(s[i:], ")")-1]
		}
	}
	return out
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

func TestMinimalIsValid(t *testing.T) {
	dir := t.TempDir()
	p := write(t, dir, "m.pdf", 3)
	if err := Validate(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(pageTexts(t, p), ","); got != "Page 1,Page 2,Page 3" {
		t.Fatalf("texts = %s", got)
	}
}

func TestOps(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	src := write(t, dir, "src.pdf", 4)
	out := func(name string) string { return filepath.Join(dir, name) }

	// Reorder.
	if err := Apply(ctx, src, out("re.pdf"), Op{Kind: "reorder", Order: []int{4, 2, 3, 1}}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(pageTexts(t, out("re.pdf")), ","); got != "Page 4,Page 2,Page 3,Page 1" {
		t.Fatalf("reorder: %s", got)
	}
	// Delete.
	if err := Apply(ctx, src, out("del.pdf"), Op{Kind: "delete", Pages: []int{2, 3}}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(pageTexts(t, out("del.pdf")), ","); got != "Page 1,Page 4" {
		t.Fatalf("delete: %s", got)
	}
	// Extract (sorted, unique).
	if err := Apply(ctx, src, out("ex.pdf"), Op{Kind: "extract", Pages: []int{3, 1, 3}}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(pageTexts(t, out("ex.pdf")), ","); got != "Page 1,Page 3" {
		t.Fatalf("extract: %s", got)
	}
	// Rotate.
	if err := Apply(ctx, src, out("rot.pdf"), Op{Kind: "rotate", Pages: []int{2}, Degrees: 90}); err != nil {
		t.Fatal(err)
	}
	if err := Validate(ctx, out("rot.pdf")); err != nil {
		t.Fatal(err)
	}
	dims, err := api.PageDimsFile(ctx, out("rot.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if dims[1].Width != 792 || dims[0].Width != 612 {
		t.Fatalf("rotate dims: %+v", dims)
	}
	// Merge.
	other := write(t, dir, "other.pdf", 2)
	if err := Apply(ctx, src, out("merged.pdf"), Op{Kind: "merge", Others: []string{other}}); err != nil {
		t.Fatal(err)
	}
	if n, _ := PageCount(ctx, out("merged.pdf")); n != 6 {
		t.Fatalf("merge count %d", n)
	}
	// Every output is valid.
	for _, f := range []string{"re.pdf", "del.pdf", "ex.pdf", "merged.pdf"} {
		if err := Validate(ctx, out(f)); err != nil {
			t.Fatalf("%s invalid: %v", f, err)
		}
	}
}

func TestOpErrors(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	src := write(t, dir, "src.pdf", 3)
	bad := []Op{
		{Kind: "delete", Pages: []int{1, 2, 3}},
		{Kind: "delete", Pages: []int{9}},
		{Kind: "reorder", Order: []int{1, 1, 2}},
		{Kind: "reorder", Order: []int{1, 2}},
		{Kind: "rotate", Pages: []int{1}, Degrees: 45},
		{Kind: "explode"},
	}
	for _, op := range bad {
		if err := Apply(ctx, src, filepath.Join(dir, "x.pdf"), op); err == nil {
			t.Errorf("%+v: expected error", op)
		}
	}
	if err := Apply(ctx, src, src, Op{Kind: "extract", Pages: []int{1}}); err == nil {
		t.Error("in-place write allowed")
	}
}

func TestSplit(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	src := write(t, dir, "book.pdf", 5)
	outDir := filepath.Join(dir, "parts")
	os.Mkdir(outDir, 0o755)
	files, err := Split(ctx, src, outDir, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 {
		t.Fatalf("files = %v", files)
	}
	total := 0
	for _, f := range files {
		n, err := PageCount(ctx, f)
		if err != nil {
			t.Fatal(err)
		}
		total += n
	}
	if total != 5 {
		t.Fatalf("total pages %d", total)
	}
}
