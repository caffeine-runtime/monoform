package pdf

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// Papers a page can be inserted with, like a notebook's: plain, lined,
// squared (5 mm) and dotted (5 mm).
var Papers = []string{"blank", "lined", "grid", "dotted"}

// insertPaper adds a page of paper (the size of page after, or of the first
// page) after page after (0: before the first), writing dst.
func insertPaper(ctx context.Context, src, dst, paper string, after, n int) error {
	if after < 0 || after > n {
		return fmt.Errorf("page %d is out of range (1–%d)", after, n)
	}
	dims, err := api.PageDimsFile(ctx, src)
	if err != nil {
		return err
	}
	ref := max(after, 1) - 1
	if ref >= len(dims) {
		return errors.New("can't read the page size")
	}
	tmp, err := os.MkdirTemp(filepath.Dir(dst), ".paper-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	sheet := filepath.Join(tmp, "paper.pdf")
	if err := writePaper(sheet, paper, dims[ref].Width, dims[ref].Height); err != nil {
		return err
	}
	merged := filepath.Join(tmp, "merged.pdf")
	if err := api.MergeCreateFile(ctx, []string{src, sheet}, merged, false, conf()); err != nil {
		return err
	}
	order := make([]int, 0, n+1)
	for p := 1; p <= after; p++ {
		order = append(order, p)
	}
	order = append(order, n+1)
	for p := after + 1; p <= n; p++ {
		order = append(order, p)
	}
	return api.CollectFile(ctx, merged, dst, selection(order), conf())
}

// writePaper writes a one-page PDF of w × h points with the paper's lines:
// light blue rules every 8 mm under a 30 mm top and with a red margin
// (lined), a 5 mm light blue grid, or 5 mm grey dots — as in Xournal++.
func writePaper(dst, paper string, w, h float64) error {
	const mm = 72 / 25.4
	f := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: w, Ht: h}})
	f.SetMargins(0, 0, 0)
	f.SetAutoPageBreak(false, 0)
	f.SetCreator("Monoform", true)
	f.AddPage()
	switch paper {
	case "blank":
	case "lined":
		f.SetLineWidth(0.5)
		f.SetDrawColor(156, 196, 228)
		for y := 30 * mm; y < h-8*mm; y += 8 * mm {
			f.Line(0, y, w, y)
		}
		f.SetDrawColor(232, 120, 120)
		f.Line(25*mm, 0, 25*mm, h)
	case "grid":
		f.SetLineWidth(0.4)
		f.SetDrawColor(178, 208, 232)
		for x := 5 * mm; x < w; x += 5 * mm {
			f.Line(x, 0, x, h)
		}
		for y := 5 * mm; y < h; y += 5 * mm {
			f.Line(0, y, w, y)
		}
	case "dotted":
		f.SetFillColor(150, 150, 156)
		for y := 5 * mm; y < h; y += 5 * mm {
			for x := 5 * mm; x < w; x += 5 * mm {
				f.Circle(x, y, 0.6, "F")
			}
		}
	default:
		return fmt.Errorf("unknown paper %q", paper)
	}
	return f.OutputFileAndClose(dst)
}
