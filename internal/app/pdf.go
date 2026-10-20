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

// PdfCompressed is the result of PdfCompress: a temp working copy and sizes.
type PdfCompressed struct {
	Path string `json:"path"`
	pdf.CompressResult
}

// PdfCompress writes a compressed copy of src to a temp working copy.
// quality 0 = lossless clean-up only; maxPx limits image size (0 = keep).
func (a *App) PdfCompress(src string, quality, maxPx int) (PdfCompressed, error) {
	dst := a.TempPath("compressed.pdf")
	r, err := pdf.Compress(context.Background(), src, dst, quality, maxPx)
	if err != nil {
		os.Remove(dst)
		return PdfCompressed{}, err
	}
	return PdfCompressed{Path: dst, CompressResult: r}, nil
}

// PdfStamp places images (signatures) on pages; returns a temp working copy.
func (a *App) PdfStamp(src string, stamps []pdf.Stamp) (string, error) {
	dst := a.TempPath("stamped.pdf")
	if err := pdf.StampImages(context.Background(), src, dst, stamps); err != nil {
		os.Remove(dst)
		return "", err
	}
	return dst, nil
}

// PdfReplacePages replaces pages with images of them (redaction); returns a
// temp working copy.
func (a *App) PdfReplacePages(src string, pages []pdf.PageImage) (string, error) {
	dst := a.TempPath("redacted.pdf")
	if err := pdf.ReplaceWithImages(context.Background(), src, dst, pages); err != nil {
		os.Remove(dst)
		return "", err
	}
	return dst, nil
}

// PdfFromImages builds a PDF from images (size "image", "A4", "Letter"…) at dst.
func (a *App) PdfFromImages(files []string, dst, size string) (string, error) {
	tmp := a.TempPath("images.pdf")
	os.Remove(tmp) // pdfcpu appends to an existing file
	defer os.Remove(tmp)
	if err := pdf.FromImages(context.Background(), files, tmp, size); err != nil {
		return "", err
	}
	if err := copyAtomic(tmp, dst); err != nil {
		return "", err
	}
	if a.watcher != nil {
		a.watcher.NoteOwnWrite(dst)
	}
	return dst, nil
}
