// Package convert turns a file into another format, in pure Go: pictures
// into other picture formats or a PDF, audio into WAV or FLAC, tables
// (CSV, TSV, Excel, OpenDocument, JSON records) into each other or a PDF,
// and documents (Markdown, plain text, Word, OpenDocument text) into
// Markdown, plain text, HTML, Word or a PDF laid out here (pdf.go).
//
// The editors' "Save and convert" and `monoform convert` both come here.
// Nothing is converted in place: dst is written atomically and src is only
// read.
package convert

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Families of formats that convert into each other. The order of outs is
// the order the formats are offered in.
type family struct {
	ins, outs []string
}

var families = []family{
	{ins: []string{"png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "icns", "heic", "heif", "avif"},
		outs: []string{"png", "jpg", "webp", "pdf", "gif", "bmp", "tiff", "ico", "icns"}},
	{ins: []string{"mp3", "wav", "flac", "ogg", "oga"}, outs: []string{"flac", "wav"}},
	{ins: []string{"csv", "tsv", "xlsx", "xlsm", "xls", "ods", "json"}, outs: []string{"xlsx", "csv", "tsv", "json", "pdf"}},
	{ins: []string{"md", "markdown", "txt", "docx", "doc", "odt"}, outs: []string{"pdf", "docx", "html", "md", "txt"}},
}

// Ext is a file's extension in lower case, without the dot, with aliases
// folded ("jpeg" → "jpg", "markdown" → "md", "tif" → "tiff").
func Ext(p string) string {
	e := strings.ToLower(strings.TrimPrefix(filepath.Ext(p), "."))
	switch e {
	case "jpeg", "jpe", "jfif":
		return "jpg"
	case "markdown":
		return "md"
	case "tif":
		return "tiff"
	case "oga":
		return "ogg"
	case "htm":
		return "html"
	}
	return e
}

func familyOf(ext string) *family {
	for i := range families {
		for _, in := range families[i].ins {
			if Ext("x."+in) == ext {
				return &families[i]
			}
		}
	}
	return nil
}

// Targets lists the formats (extensions) path can be converted to, its own
// format left out.
func Targets(path string) []string {
	ext := Ext(path)
	f := familyOf(ext)
	if f == nil {
		return nil
	}
	var out []string
	for _, o := range f.outs {
		if o != ext && !(ext == "xlsm" && o == "xlsx") {
			out = append(out, o)
		}
	}
	return out
}

// Families lists the formats each family converts to, in the order offered
// (to merge the lists of several files).
func Families() [][]string {
	out := make([][]string, len(families))
	for i, f := range families {
		out[i] = slices.Clone(f.outs)
	}
	return out
}

// Formats lists every input extension with its targets, for the interface.
func Formats() map[string][]string {
	m := map[string][]string{}
	for _, f := range families {
		for _, in := range f.ins {
			m[in] = Targets("x." + in)
		}
	}
	return m
}

// Result says what a conversion left out, when it had to: Note in English
// (for the command line), Code and Arg for the interface to say it in the
// user's language.
type Result struct {
	Note string `json:"note"`
	// "firstSheet" (Arg: the sheet's name), "firstRows" (Arg: how many) or
	// "missingGlyphs" (Arg: some of the characters).
	Code string `json:"code"`
	Arg  string `json:"arg"`
}

func firstSheet(name string) Result {
	return Result{Note: fmt.Sprintf("only the first sheet, %q", name), Code: "firstSheet", Arg: name}
}

func firstRows(n int) Result {
	return Result{Note: fmt.Sprintf("only the first %d rows", n), Code: "firstRows", Arg: fmt.Sprint(n)}
}

func missingGlyphs(chars string) Result {
	if chars == "" {
		return Result{}
	}
	return Result{Note: "the PDF's fonts have no letters for some of the text (" + chars + "), which shows as gaps", Code: "missingGlyphs", Arg: chars}
}

// ErrUnsupported is returned for pairs of formats that don't convert.
var ErrUnsupported = errors.New("these formats don't convert into each other")

// Convert writes src in the format of dst's extension. progress (may be
// nil) reports long conversions (audio) as done/total.
func Convert(ctx context.Context, src, dst string, progress func(done, total int64)) (Result, error) {
	from, to := Ext(src), Ext(dst)
	if !slices.Contains(Targets(src), to) {
		return Result{}, fmt.Errorf("can't convert .%s to .%s: %w", from, to, ErrUnsupported)
	}
	if same(src, dst) {
		return Result{}, errors.New("the converted file would replace the original")
	}
	if st, err := os.Stat(src); err != nil {
		return Result{}, err
	} else if st.IsDir() {
		return Result{}, errors.New("a folder can't be converted")
	}
	if progress == nil {
		progress = func(int64, int64) {}
	}
	switch familyOf(from) {
	case &families[0]:
		return Result{}, convertImage(ctx, src, dst, to)
	case &families[1]:
		return Result{}, convertAudio(ctx, src, dst, to, progress)
	case &families[2]:
		return convertTable(ctx, src, dst, from, to)
	default:
		return convertDocument(ctx, src, dst, from, to)
	}
}

func same(a, b string) bool {
	aa, err1 := filepath.Abs(a)
	bb, err2 := filepath.Abs(b)
	if err1 != nil || err2 != nil {
		return a == b
	}
	if strings.EqualFold(aa, bb) {
		return true
	}
	sa, err1 := os.Stat(aa)
	sb, err2 := os.Stat(bb)
	return err1 == nil && err2 == nil && os.SameFile(sa, sb)
}
