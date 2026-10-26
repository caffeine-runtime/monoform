// Package pdf implements page operations (rotate, delete, reorder, extract,
// merge, split) with pdfcpu. Operations read a source file and write a new
// file; the frontend keeps a working copy until the user saves.
package pdf

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func init() {
	// Never read or create ~/.config/pdfcpu.
	model.ConfigPath = "disable"
}

func conf() *model.Configuration {
	c := model.NewDefaultConfiguration()
	c.ValidationMode = model.ValidationRelaxed
	return c
}

// Op describes one page operation. Page numbers are 1-based.
type Op struct {
	Kind    string   `json:"kind"`    // rotate | delete | reorder | extract | merge | paper
	Pages   []int    `json:"pages"`   // rotate, delete, extract
	Degrees int      `json:"degrees"` // rotate: ±90, 180
	Order   []int    `json:"order"`   // reorder: new page sequence (a permutation)
	Others  []string `json:"others"`  // merge: files appended after src
	// paper: insert a page of this paper (blank, lined, grid, dotted) after
	// page After (0: before the first page).
	Paper string `json:"paper,omitempty"`
	After int    `json:"after,omitempty"`
}

func selection(pages []int) []string {
	out := make([]string, len(pages))
	for i, p := range pages {
		out[i] = strconv.Itoa(p)
	}
	return out
}

// PageCount returns the number of pages.
func PageCount(ctx context.Context, path string) (int, error) {
	return api.PageCountFile(ctx, path)
}

// Apply performs op on src and writes the result to dst (dst != src).
func Apply(ctx context.Context, src, dst string, op Op) error {
	if filepath.Clean(src) == filepath.Clean(dst) {
		return errors.New("source and destination must differ")
	}
	n, err := PageCount(ctx, src)
	if err != nil {
		return fmt.Errorf("reading PDF: %w", err)
	}
	if err := checkPages(op.Pages, n); err != nil && op.Kind != "merge" && op.Kind != "reorder" && op.Kind != "paper" {
		return err
	}
	switch op.Kind {
	case "rotate":
		if op.Degrees%90 != 0 || op.Degrees == 0 {
			return errors.New("rotation must be a multiple of 90")
		}
		if len(op.Pages) == 0 {
			return errors.New("no pages selected")
		}
		return api.RotateFile(ctx, src, dst, op.Degrees, selection(op.Pages), conf())
	case "delete":
		if len(op.Pages) == 0 {
			return errors.New("no pages selected")
		}
		if len(uniq(op.Pages)) >= n {
			return errors.New("can't delete every page")
		}
		return api.RemovePagesFile(ctx, src, dst, selection(op.Pages), conf())
	case "reorder":
		if err := checkPermutation(op.Order, n); err != nil {
			return err
		}
		return api.CollectFile(ctx, src, dst, selection(op.Order), conf())
	case "extract":
		if len(op.Pages) == 0 {
			return errors.New("no pages selected")
		}
		p := append([]int(nil), op.Pages...)
		sort.Ints(p)
		return api.CollectFile(ctx, src, dst, selection(uniq(p)), conf())
	case "merge":
		if len(op.Others) == 0 {
			return errors.New("nothing to merge")
		}
		files := append([]string{src}, op.Others...)
		return api.MergeCreateFile(ctx, files, dst, false, conf())
	case "paper":
		return insertPaper(ctx, src, dst, op.Paper, op.After, n)
	default:
		return fmt.Errorf("unknown operation %q", op.Kind)
	}
}

// Split writes src into files of span pages each in outDir, named
// <stem>_<n>.pdf, and returns their paths.
func Split(ctx context.Context, src, outDir string, span int) ([]string, error) {
	if span < 1 {
		return nil, errors.New("span must be at least 1")
	}
	before, _ := os.ReadDir(outDir)
	seen := map[string]bool{}
	for _, d := range before {
		seen[d.Name()] = true
	}
	if err := api.SplitFile(ctx, src, outDir, span, conf()); err != nil {
		return nil, err
	}
	after, err := os.ReadDir(outDir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, d := range after {
		if !seen[d.Name()] && strings.HasSuffix(strings.ToLower(d.Name()), ".pdf") {
			out = append(out, filepath.Join(outDir, d.Name()))
		}
	}
	sort.Strings(out)
	return out, nil
}

// Validate checks that path is a structurally valid PDF.
func Validate(ctx context.Context, path string) error {
	c := conf()
	c.ValidationMode = model.ValidationStrict
	return api.ValidateFile(ctx, path, c, nil)
}

func checkPages(pages []int, n int) error {
	for _, p := range pages {
		if p < 1 || p > n {
			return fmt.Errorf("page %d out of range (1-%d)", p, n)
		}
	}
	return nil
}

func checkPermutation(order []int, n int) error {
	if len(order) != n {
		return fmt.Errorf("order must list all %d pages", n)
	}
	seen := make([]bool, n+1)
	for _, p := range order {
		if p < 1 || p > n || seen[p] {
			return errors.New("order must be a permutation of the pages")
		}
		seen[p] = true
	}
	return nil
}

func uniq(p []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, x := range p {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}
