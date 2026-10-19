package office

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

// excelize can't store computed results in formula cells, so readers that
// trust cached values (LibreOffice by default, file previews) would show stale
// numbers after an edit. writeWithCachedResults writes the workbook and then
// puts freshly computed results into each formula cell's <v>.
func (b *book) writeWithCachedResults(w io.Writer) error {
	var buf bytes.Buffer
	if _, err := b.f.WriteTo(&buf); err != nil {
		return err
	}
	results := map[string]map[string]string{} // sheet -> ref -> raw value
	for sheet, refs := range b.formulas {
		for _, ref := range refs {
			v, err := b.f.CalcCellValue(sheet, ref, excelize.Options{RawCellValue: true})
			if err != nil {
				continue
			}
			if results[sheet] == nil {
				results[sheet] = map[string]string{}
			}
			results[sheet][ref] = v
		}
	}
	if len(results) == 0 {
		_, err := w.Write(buf.Bytes())
		return err
	}
	return patchCachedValues(bytes.NewReader(buf.Bytes()), int64(buf.Len()), w, results)
}

func patchCachedValues(r io.ReaderAt, size int64, w io.Writer, results map[string]map[string]string) error {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return err
	}
	paths, err := sheetPaths(zr)
	if err != nil {
		return err
	}
	byPath := map[string]map[string]string{}
	for sheet, vals := range results {
		if p, ok := paths[sheet]; ok {
			byPath[p] = vals
		}
	}
	zw := zip.NewWriter(w)
	for _, f := range zr.File {
		vals, ok := byPath[f.Name]
		if !ok {
			if err := zw.Copy(f); err != nil {
				return err
			}
			continue
		}
		data, err := readZipFile(f, 1<<30)
		if err != nil {
			return err
		}
		out, err := zw.CreateHeader(&zip.FileHeader{Name: f.Name, Method: zip.Deflate})
		if err != nil {
			return err
		}
		if _, err := out.Write(setCellValues(data, vals)); err != nil {
			return err
		}
	}
	return zw.Close()
}

// sheetPaths maps sheet names to their worksheet part names.
func sheetPaths(zr *zip.Reader) (map[string]string, error) {
	read := func(name string) ([]byte, error) {
		for _, f := range zr.File {
			if f.Name == name {
				return readZipFile(f, 64<<20)
			}
		}
		return nil, fmt.Errorf("%s missing", name)
	}
	wb, err := read("xl/workbook.xml")
	if err != nil {
		return nil, err
	}
	rels, err := read("xl/_rels/workbook.xml.rels")
	if err != nil {
		return nil, err
	}
	var wbDoc struct {
		Sheets []struct {
			Name string `xml:"name,attr"`
			RID  string `xml:"http://schemas.openxmlformats.org/officeDocument/2006/relationships id,attr"`
		} `xml:"sheets>sheet"`
	}
	var relDoc struct {
		Rels []struct {
			ID     string `xml:"Id,attr"`
			Target string `xml:"Target,attr"`
		} `xml:"Relationship"`
	}
	if err := xml.Unmarshal(wb, &wbDoc); err != nil {
		return nil, err
	}
	if err := xml.Unmarshal(rels, &relDoc); err != nil {
		return nil, err
	}
	targets := map[string]string{}
	for _, r := range relDoc.Rels {
		t := r.Target
		if strings.HasPrefix(t, "/") {
			t = strings.TrimPrefix(t, "/")
		} else {
			t = path.Join("xl", t)
		}
		targets[r.ID] = t
	}
	out := map[string]string{}
	for _, s := range wbDoc.Sheets {
		out[s.Name] = targets[s.RID]
	}
	return out, nil
}

var (
	cellOpen = regexp.MustCompile(`<c r="([A-Z]+[0-9]+)"([^>]*?)(/>|>)`)
	tAttr    = regexp.MustCompile(`\s+t="[^"]*"`)
	vElem    = regexp.MustCompile(`<v>[^<]*</v>|<v/>`)
)

// setCellValues rewrites the cached <v> of the given cells in a worksheet XML.
func setCellValues(data []byte, vals map[string]string) []byte {
	var out bytes.Buffer
	pos := 0
	for _, m := range cellOpen.FindAllSubmatchIndex(data, -1) {
		ref := string(data[m[2]:m[3]])
		v, ok := vals[ref]
		selfClosing := string(data[m[6]:m[7]]) == "/>"
		if !ok || selfClosing {
			continue
		}
		end := bytes.Index(data[m[1]:], []byte("</c>"))
		if end < 0 {
			continue
		}
		body := data[m[1] : m[1]+end]
		if !bytes.Contains(body, []byte("<f")) {
			continue
		}
		attrs := tAttr.ReplaceAll(data[m[4]:m[5]], nil)
		typ, text := cachedType(v)
		out.Write(data[pos:m[0]])
		fmt.Fprintf(&out, `<c r="%s"%s`, ref, attrs)
		if typ != "" {
			fmt.Fprintf(&out, ` t="%s"`, typ)
		}
		out.WriteString(">")
		nb := vElem.ReplaceAll(body, nil)
		out.Write(nb)
		out.WriteString("<v>")
		xml.EscapeText(&out, []byte(text))
		out.WriteString("</v></c>")
		pos = m[1] + end + len("</c>")
	}
	out.Write(data[pos:])
	return out.Bytes()
}

func cachedType(v string) (string, string) {
	if _, err := strconv.ParseFloat(v, 64); err == nil {
		return "", v
	}
	switch strings.ToUpper(v) {
	case "TRUE":
		return "b", "1"
	case "FALSE":
		return "b", "0"
	}
	if strings.HasPrefix(v, "#") && strings.HasSuffix(v, "!") || v == "#N/A" || v == "#NAME?" {
		return "e", v
	}
	return "str", v
}
