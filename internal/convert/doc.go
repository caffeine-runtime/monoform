package convert

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// A Doc is what documents convert through: a flat list of blocks, each a
// run of styled text. Every reader (Markdown, text, Word, OpenDocument)
// builds one and every writer (Markdown, text, HTML, Word, PDF) takes one,
// so all pairs convert alike.
type Doc struct {
	Title  string
	Blocks []Block
	// Landscape pages (wide tables) in the PDF.
	Landscape bool
	// Base folder for relative picture paths (the source's folder).
	Base string
	// Pictures unpacked from a Word/OpenDocument file live here until the
	// conversion ends.
	tmp string
}

type BlockKind int

const (
	Para BlockKind = iota
	Heading
	ListItem
	Code
	Quote
	Rule
	Table
	Picture
)

type Block struct {
	Kind BlockKind
	// Heading: 1–6. ListItem: nesting, 0 for the outer list.
	Level int
	// ListItem: numbered, with this number.
	Ordered bool
	Number  int
	Runs    []Inline
	// Code: the text. Picture: the path (absolute, or relative to Doc.Base).
	Text string
	// Picture: its description.
	Alt string
	// Table: rows of cells; the first row is the header.
	Rows [][][]Inline
}

type Inline struct {
	Text                 string // "\n" is a line break
	Bold, Italic, Strike bool
	Code                 bool
	Link                 string
}

func plain(s string) []Inline {
	if s == "" {
		return nil
	}
	return []Inline{{Text: s}}
}

// runsText is the text of runs without formatting.
func runsText(runs []Inline) string {
	var b strings.Builder
	for _, r := range runs {
		b.WriteString(r.Text)
	}
	return b.String()
}

func stemOf(p string) string {
	return strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
}

// picturePath resolves a picture of the document to a file on disk ("" for
// web addresses and missing files).
func (d *Doc) picturePath(p string) string {
	if p == "" || strings.Contains(p, "://") || strings.HasPrefix(p, "data:") {
		return ""
	}
	if !filepath.IsAbs(p) {
		p = filepath.Join(d.Base, filepath.FromSlash(p))
	}
	if st, err := os.Stat(p); err != nil || st.IsDir() {
		return ""
	}
	return p
}

func (d *Doc) cleanup() {
	if d.tmp != "" {
		os.RemoveAll(d.tmp)
	}
}

func readDocument(p, ext string) (*Doc, error) {
	var d *Doc
	var err error
	switch ext {
	case "md":
		var b []byte
		if b, err = readText(p); err == nil {
			d = ParseMarkdown(string(b))
		}
	case "txt":
		var b []byte
		if b, err = readText(p); err == nil {
			d = parsePlain(string(b))
		}
	case "docx":
		d, err = readDocx(p)
	case "odt":
		d, err = readOdt(p)
	case "doc":
		d, err = readWordDoc(p)
	default:
		err = ErrUnsupported
	}
	if err != nil {
		return nil, err
	}
	d.Base = filepath.Dir(p)
	if d.Title == "" {
		d.Title = stemOf(p)
		for _, b := range d.Blocks {
			if b.Kind == Heading {
				d.Title = runsText(b.Runs)
				break
			}
		}
	}
	return d, nil
}

// Largest text document read whole.
const maxText = 64 << 20

func readText(p string) ([]byte, error) {
	st, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	if st.Size() > maxText {
		return nil, errors.New("this file is too large to convert as a document")
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	return decodeText(b), nil
}

// parsePlain keeps a text file's lines: paragraphs are split at blank
// lines, and lines inside a paragraph stay lines.
func parsePlain(s string) *Doc {
	d := &Doc{}
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	for _, para := range strings.Split(s, "\n\n") {
		para = strings.Trim(para, "\n")
		if strings.TrimSpace(para) == "" {
			continue
		}
		d.Blocks = append(d.Blocks, Block{Kind: Para, Runs: plain(para)})
	}
	return d
}

func convertDocument(ctx context.Context, src, dst, from, to string) (Result, error) {
	d, err := readDocument(src, from)
	if err != nil {
		return Result{}, err
	}
	defer d.cleanup()
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	switch to {
	case "pdf":
		missing, err := writePDF(ctx, dst, d)
		return missingGlyphs(missing), err
	case "docx":
		return Result{}, writeDocx(dst, d)
	case "html":
		return Result{}, writeHTML(dst, d)
	case "md":
		return Result{}, writeMarkdown(dst, d)
	case "txt":
		return Result{}, writePlain(dst, d)
	}
	return Result{}, ErrUnsupported
}
