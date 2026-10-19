package office

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/caffeine-runtime/hold-it-all/internal/fs"
)

const documentPart = "word/document.xml"

// Relationship is one entry of word/_rels/document.xml.rels.
type Relationship struct {
	ID       string `json:"id"`
	Type     string `json:"type"`   // last path element of the type URI, e.g. "image", "hyperlink"
	Target   string `json:"target"` // zip entry for internal targets, URL for external ones
	External bool   `json:"external"`
}

// DocxPackage is what the editor needs from a .docx.
type DocxPackage struct {
	Document string            `json:"document"` // word/document.xml
	Styles   map[string]string `json:"styles"`   // styleId -> style name ("heading 1")
	Rels     []Relationship    `json:"rels"`
}

// ReadDocx extracts the main document part, style names and relationships.
func ReadDocx(p string) (DocxPackage, error) {
	zr, err := zip.OpenReader(p)
	if err != nil {
		return DocxPackage{}, fmt.Errorf("not a Word document: %w", err)
	}
	defer zr.Close()
	pkg := DocxPackage{Styles: map[string]string{}}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	doc, ok := files[documentPart]
	if !ok {
		return pkg, errors.New("word/document.xml is missing")
	}
	b, err := readZipFile(doc, 256<<20)
	if err != nil {
		return pkg, err
	}
	pkg.Document = string(b)
	if f, ok := files["word/styles.xml"]; ok {
		if b, err := readZipFile(f, 32<<20); err == nil {
			pkg.Styles = styleNames(b)
		}
	}
	if f, ok := files["word/_rels/document.xml.rels"]; ok {
		if b, err := readZipFile(f, 8<<20); err == nil {
			pkg.Rels = rels(b)
		}
	}
	return pkg, nil
}

func readZipFile(f *zip.File, limit int64) ([]byte, error) {
	if f.UncompressedSize64 > uint64(limit) {
		return nil, fmt.Errorf("%s is too large", f.Name)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, limit))
}

func styleNames(b []byte) map[string]string {
	var doc struct {
		Styles []struct {
			ID   string `xml:"styleId,attr"`
			Name struct {
				Val string `xml:"val,attr"`
			} `xml:"name"`
		} `xml:"style"`
	}
	out := map[string]string{}
	if xml.Unmarshal(b, &doc) == nil {
		for _, s := range doc.Styles {
			out[s.ID] = strings.ToLower(s.Name.Val)
		}
	}
	return out
}

func rels(b []byte) []Relationship {
	var doc struct {
		Rels []struct {
			ID     string `xml:"Id,attr"`
			Type   string `xml:"Type,attr"`
			Target string `xml:"Target,attr"`
			Mode   string `xml:"TargetMode,attr"`
		} `xml:"Relationship"`
	}
	var out []Relationship
	if xml.Unmarshal(b, &doc) != nil {
		return nil
	}
	for _, r := range doc.Rels {
		ext := r.Mode == "External"
		target := r.Target
		if !ext {
			target = path.Clean(path.Join("word", target))
			target = strings.TrimPrefix(target, "/")
		}
		out = append(out, Relationship{ID: r.ID, Type: path.Base(r.Type), Target: target, External: ext})
	}
	return out
}

// WriteDocx writes a .docx to dst: every part of src is copied unchanged
// except word/document.xml, which is replaced. With src empty a new package
// is created from a minimal template.
func WriteDocx(dst, src, document string) error {
	if !strings.HasPrefix(strings.TrimSpace(document), "<?xml") && !strings.HasPrefix(strings.TrimSpace(document), "<w:document") {
		return errors.New("document.xml is not XML")
	}
	if err := xml.Unmarshal([]byte(document), new(struct{})); err != nil {
		return fmt.Errorf("document.xml is not well-formed: %w", err)
	}
	return fs.AtomicWrite(dst, func(w io.Writer) error {
		zw := zip.NewWriter(w)
		if src == "" {
			for _, part := range templateParts {
				if err := writePart(zw, part.name, []byte(part.body)); err != nil {
					return err
				}
			}
			if err := writePart(zw, documentPart, []byte(document)); err != nil {
				return err
			}
			return zw.Close()
		}
		zr, err := zip.OpenReader(src)
		if err != nil {
			return err
		}
		defer zr.Close()
		wrote := false
		for _, f := range zr.File {
			if f.Name == documentPart {
				if err := writePart(zw, documentPart, []byte(document)); err != nil {
					return err
				}
				wrote = true
				continue
			}
			// Copy the compressed bytes as they are.
			if err := zw.Copy(f); err != nil {
				return err
			}
		}
		if !wrote {
			if err := writePart(zw, documentPart, []byte(document)); err != nil {
				return err
			}
		}
		return zw.Close()
	})
}

func writePart(zw *zip.Writer, name string, body []byte) error {
	w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
	if err != nil {
		return err
	}
	_, err = w.Write(body)
	return err
}

// ReadZipEntry returns one entry of a zip-based file (images inside .docx).
func ReadZipEntry(p, entry string, limit int64) ([]byte, error) {
	zr, err := zip.OpenReader(p)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name == entry {
			return readZipFile(f, limit)
		}
	}
	return nil, os.ErrNotExist
}

// ParagraphsToDocument builds a document.xml body from plain paragraphs
// (used to convert legacy .doc text).
func ParagraphsToDocument(paras []string) string {
	var b bytes.Buffer
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	b.WriteString(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>`)
	for _, p := range paras {
		b.WriteString(`<w:p>`)
		if p != "" {
			b.WriteString(`<w:r><w:t xml:space="preserve">`)
			xml.EscapeText(&b, []byte(p))
			b.WriteString(`</w:t></w:r>`)
		}
		b.WriteString(`</w:p>`)
	}
	b.WriteString(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`)
	return b.String()
}

var templateParts = []struct{ name, body string }{
	{"[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`},
	{"_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`},
	{"word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
	{"word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`},
}
