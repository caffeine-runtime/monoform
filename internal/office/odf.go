package office

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/caffeine-runtime/monoform/internal/fs"
)

// OpenDocument (.odt/.ods) packages: a zip whose first entry is an
// uncompressed "mimetype", with the body in content.xml.

const (
	nsOffice = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
	nsTable  = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
	nsText   = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
	nsStyle  = "urn:oasis:names:tc:opendocument:xmlns:style:1.0"

	mimeODT = "application/vnd.oasis.opendocument.text"
	mimeODS = "application/vnd.oasis.opendocument.spreadsheet"
)

// ErrODFEncrypted is returned for password-protected OpenDocument files.
var ErrODFEncrypted = errors.New("this document is password-protected, which isn't supported")

// openODF opens an OpenDocument package of the given type (templates too)
// and returns its parts by name.
func openODF(p, mime string) (*zip.ReadCloser, map[string]*zip.File, error) {
	zr, err := zip.OpenReader(p)
	if err != nil {
		return nil, nil, fmt.Errorf("not an OpenDocument file: %w", err)
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	fail := func(err error) (*zip.ReadCloser, map[string]*zip.File, error) {
		zr.Close()
		return nil, nil, err
	}
	if f, ok := files["mimetype"]; ok {
		b, err := readZipFile(f, 256)
		if err != nil {
			return fail(err)
		}
		if got := strings.TrimSpace(string(b)); !strings.HasPrefix(got, mime) {
			return fail(fmt.Errorf("this is %s, not %s", got, mime))
		}
	}
	if f, ok := files["META-INF/manifest.xml"]; ok {
		if b, err := readZipFile(f, 8<<20); err == nil && bytes.Contains(b, []byte("encryption-data")) {
			return fail(ErrODFEncrypted)
		}
	}
	if _, ok := files["content.xml"]; !ok {
		return fail(errors.New("content.xml is missing"))
	}
	return zr, files, nil
}

// OdtPackage is what the editor needs from an .odt.
type OdtPackage struct {
	Content string            `json:"content"` // content.xml
	Styles  map[string]string `json:"styles"`  // paragraph style name -> display name, lower-case ("heading 1")
	// Named text styles -> their formatting flags ("b i u s"), so text in
	// e.g. "Strong" shows bold.
	TextStyles map[string]string `json:"textStyles"`
}

// ReadOdt extracts content.xml and the names of the document's paragraph styles.
func ReadOdt(p string) (OdtPackage, error) {
	zr, files, err := openODF(p, mimeODT)
	if err != nil {
		return OdtPackage{}, err
	}
	defer zr.Close()
	b, err := readZipFile(files["content.xml"], 256<<20)
	if err != nil {
		return OdtPackage{}, err
	}
	pkg := OdtPackage{Content: string(b), Styles: map[string]string{}, TextStyles: map[string]string{}}
	if f, ok := files["styles.xml"]; ok {
		if sb, err := readZipFile(f, 32<<20); err == nil {
			pkg.Styles, pkg.TextStyles = odfStyleNames(sb)
		}
	}
	return pkg, nil
}

// odfStyleNames maps paragraph style names to their display names, and
// text style names to their bold/italic/underline/strike flags.
func odfStyleNames(b []byte) (map[string]string, map[string]string) {
	out, text := map[string]string{}, map[string]string{}
	d := xml.NewDecoder(bytes.NewReader(b))
	for {
		tok, err := d.Token()
		if err != nil {
			return out, text
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Space != nsStyle || se.Name.Local != "style" {
			continue
		}
		var name, display, family string
		for _, a := range se.Attr {
			if a.Name.Space != nsStyle {
				continue
			}
			switch a.Name.Local {
			case "name":
				name = a.Value
			case "display-name":
				display = a.Value
			case "family":
				family = a.Value
			}
		}
		if family == "text" && name != "" {
			text[name] = textFlags(d)
			continue
		}
		if family != "paragraph" || name == "" {
			continue
		}
		if display == "" {
			display = decodeStyleName(name)
		}
		out[name] = strings.ToLower(display)
	}
}

// decodeStyleName undoes ODF's name encoding ("Heading_20_1" -> "Heading 1").
func decodeStyleName(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '_' {
			if j := strings.IndexByte(s[i+1:], '_'); j > 0 && j <= 4 {
				var v int
				if _, err := fmt.Sscanf(s[i+1:i+1+j], "%x", &v); err == nil {
					b.WriteRune(rune(v))
					i += j + 1
					continue
				}
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

// WriteODF writes an OpenDocument package to dst: every part of src is
// copied unchanged (the stored mimetype stays first) except content.xml.
func WriteODF(dst, src string, content []byte) error {
	if err := xml.Unmarshal(content, new(struct{})); err != nil {
		return fmt.Errorf("content.xml is not well-formed: %w", err)
	}
	// Read the source first: it may be the file being replaced.
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	return fs.AtomicWrite(dst, func(w io.Writer) error {
		zw := zip.NewWriter(w)
		for _, f := range zr.File {
			if f.Name == "content.xml" {
				if err := writePart(zw, f.Name, content); err != nil {
					return err
				}
				continue
			}
			if err := zw.Copy(f); err != nil {
				return err
			}
		}
		return zw.Close()
	})
}

// textFlags reads a style's text properties (the style:style start tag
// consumed) as "b i u s" flags.
func textFlags(d *xml.Decoder) string {
	var flags []string
	for depth := 1; depth > 0; {
		tok, err := d.Token()
		if err != nil {
			break
		}
		switch tk := tok.(type) {
		case xml.StartElement:
			depth++
			if tk.Name.Local != "text-properties" {
				continue
			}
			for _, a := range tk.Attr {
				switch {
				case a.Name.Local == "font-weight" && a.Name.Space != nsStyle && (a.Value == "bold" || a.Value >= "600" && a.Value <= "900"):
					flags = append(flags, "b")
				case a.Name.Local == "font-style" && a.Name.Space != nsStyle && (a.Value == "italic" || a.Value == "oblique"):
					flags = append(flags, "i")
				case a.Name.Local == "text-underline-style" && a.Value != "none":
					flags = append(flags, "u")
				case a.Name.Local == "text-line-through-style" && a.Value != "none":
					flags = append(flags, "s")
				}
			}
		case xml.EndElement:
			depth--
		}
	}
	return strings.Join(flags, " ")
}
