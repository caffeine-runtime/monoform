package app

import (
	"context"
	"os"

	"github.com/caffeine-runtime/hold-it-all/internal/fs"
	"github.com/caffeine-runtime/hold-it-all/internal/jobs"
	"github.com/caffeine-runtime/hold-it-all/internal/pdf"
)

// PdfOp applies a page operation to src and returns the path of the result.
// With dst empty the result goes to a temp working copy.
func (a *App) PdfOp(src, dst string, op pdf.Op) (string, error) {
	if dst == "" {
		dst = a.TempPath("working.pdf")
	}
	out := dst
	if _, err := os.Stat(dst); err == nil {
		// Never write over an existing file directly: build it next to it,
		// then replace atomically.
		out = a.TempPath("op.pdf")
		defer os.Remove(out)
	}
	if err := pdf.Apply(context.Background(), src, out, op); err != nil {
		return "", err
	}
	if out != dst {
		if err := copyAtomic(out, dst); err != nil {
			return "", err
		}
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(dst)
	}
	return dst, nil
}

// PdfSplit splits src into parts of span pages in outDir (background job;
// the result is the list of files).
func (a *App) PdfSplit(src, outDir string, span int) string {
	return a.Jobs.Start("pdf-split", "Splitting PDF", func(ctx context.Context, r *jobs.Reporter) (any, error) {
		return pdf.Split(ctx, src, outDir, span)
	})
}

// PdfPageCount returns the number of pages of a PDF on disk.
func (a *App) PdfPageCount(p string) (int, error) { return pdf.PageCount(context.Background(), p) }

// CopyFile atomically copies src over dst (saving a working copy).
func (a *App) CopyFile(src, dst string) error {
	if err := copyAtomic(src, dst); err != nil {
		return err
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(dst)
	}
	return nil
}

func copyAtomic(src, dst string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	return fs.AtomicWriteReader(dst, f)
}
