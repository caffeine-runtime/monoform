package convert

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"github.com/caffeine-runtime/monoform/internal/audio"
	"github.com/caffeine-runtime/monoform/internal/office"
	"github.com/caffeine-runtime/monoform/internal/pdf"
)

func convert(t *testing.T, src, dst string) Result {
	t.Helper()
	r, err := Convert(context.Background(), src, dst, nil)
	if err != nil {
		t.Fatalf("%s → %s: %v", filepath.Base(src), filepath.Ext(dst), err)
	}
	if st, err := os.Stat(dst); err != nil || st.Size() == 0 {
		t.Fatalf("%s not written", dst)
	}
	return r
}

func write(t *testing.T, dir, name, body string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func pages(t *testing.T, p string) int {
	t.Helper()
	n, err := pdf.PageCount(context.Background(), p)
	if err != nil {
		t.Fatalf("%s is not a valid PDF: %v", p, err)
	}
	return n
}

func TestTargets(t *testing.T) {
	cases := map[string][]string{
		"a.PNG":      {"jpg", "webp", "pdf", "gif", "bmp", "tiff", "ico", "icns"},
		"a.jpeg":     {"png", "webp", "pdf", "gif", "bmp", "tiff", "ico", "icns"},
		"a.heic":     {"png", "jpg", "webp", "pdf", "gif", "bmp", "tiff", "ico", "icns"},
		"a.mp3":      {"flac", "wav"},
		"a.flac":     {"wav"},
		"a.csv":      {"xlsx", "tsv", "json", "pdf"},
		"a.xlsm":     {"csv", "tsv", "json", "pdf"},
		"a.markdown": {"pdf", "docx", "html", "txt"},
		"a.docx":     {"pdf", "html", "md", "txt"},
		"a.svg":      nil,
		"a.zip":      nil,
		"noext":      nil,
	}
	for p, want := range cases {
		if got := Targets(p); !reflect.DeepEqual(got, want) {
			t.Errorf("Targets(%s) = %v, want %v", p, got, want)
		}
	}
	if f := Formats(); len(f["odt"]) == 0 || len(f["oga"]) == 0 || f["md"] == nil {
		t.Errorf("Formats: %v", f)
	}
}

func TestRefuses(t *testing.T) {
	dir := t.TempDir()
	src := write(t, dir, "a.md", "# Hi")
	if _, err := Convert(context.Background(), src, filepath.Join(dir, "a.png"), nil); !errors.Is(err, ErrUnsupported) {
		t.Errorf("md → png: %v", err)
	}
	if _, err := Convert(context.Background(), src, src, nil); err == nil {
		t.Error("converted onto itself")
	}
	if _, err := Convert(context.Background(), filepath.Join(dir, "missing.md"), filepath.Join(dir, "x.pdf"), nil); err == nil {
		t.Error("missing file converted")
	}
	if _, err := Convert(context.Background(), write(t, dir, "obj.json", `{"a": 1}`), filepath.Join(dir, "x.csv"), nil); err == nil || !strings.Contains(err.Error(), "isn't a table") {
		t.Errorf("non-table JSON: %v", err)
	}
}

func testImage(t *testing.T, dir string) string {
	m := image.NewNRGBA(image.Rect(0, 0, 64, 40))
	for y := range 40 {
		for x := range 64 {
			m.Set(x, y, color.NRGBA{uint8(x * 4), uint8(y * 6), 128, 255})
		}
	}
	m.Set(0, 0, color.NRGBA{0, 0, 0, 0})
	p := filepath.Join(dir, "pic.png")
	f, _ := os.Create(p)
	png.Encode(f, m)
	f.Close()
	return p
}

func TestImages(t *testing.T) {
	dir := t.TempDir()
	src := testImage(t, dir)
	for _, ext := range Targets(src) {
		dst := filepath.Join(dir, "out."+ext)
		convert(t, src, dst)
		switch ext {
		case "pdf":
			if n := pages(t, dst); n != 1 {
				t.Errorf("pdf: %d pages", n)
			}
		default:
			img, err := DecodeImage(context.Background(), dst)
			if err != nil {
				t.Fatalf("%s: %v", ext, err)
			}
			want := image.Pt(64, 40)
			if ext == "ico" || ext == "icns" {
				want = image.Pt(img.Bounds().Dx(), img.Bounds().Dx()) // square sizes
			}
			if img.Bounds().Size() != want {
				t.Errorf("%s: %v", ext, img.Bounds())
			}
		}
	}
	// A picture that isn't PNG/JPEG/TIFF/WebP becomes a PNG on the PDF page.
	convert(t, filepath.Join(dir, "out.bmp"), filepath.Join(dir, "bmp.pdf"))
	if n := pages(t, filepath.Join(dir, "bmp.pdf")); n != 1 {
		t.Errorf("bmp → pdf: %d pages", n)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".*")); len(left) > 0 {
		t.Errorf("temp files left: %v", left)
	}
}

func writeTone(t *testing.T, p string, frames int) {
	var b bytes.Buffer
	le := func(v any) { binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	le(uint32(36 + frames*4))
	b.WriteString("WAVEfmt ")
	le(uint32(16))
	le(uint16(1))
	le(uint16(2))
	le(uint32(44100))
	le(uint32(44100 * 4))
	le(uint16(4))
	le(uint16(16))
	b.WriteString("data")
	le(uint32(frames * 4))
	for i := range frames {
		v := int16((i%100 - 50) * 300)
		le(v)
		le(-v)
	}
	if err := os.WriteFile(p, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestAudio(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "tone.wav")
	writeTone(t, src, 30000)
	convert(t, src, filepath.Join(dir, "tone.flac"))
	convert(t, filepath.Join(dir, "tone.flac"), filepath.Join(dir, "back.wav"))
	a, _ := os.ReadFile(src)
	b, _ := os.ReadFile(filepath.Join(dir, "back.wav"))
	if !bytes.Equal(a[len(a)-120000:], b[len(b)-120000:]) {
		t.Error("WAV → FLAC → WAV changed the samples")
	}
	for _, f := range []string{"tone.mp3", "tone.ogg"} {
		in := filepath.Join("..", "audio", "testdata", f)
		dst := filepath.Join(dir, f+".flac")
		convert(t, in, dst)
		info, _, err := audio.Probe(dst)
		src, _, _ := audio.Probe(in)
		if err != nil || info.Frames != src.Frames || info.Codec != audio.FLAC {
			t.Errorf("%s → flac: %+v %v", f, info, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Convert(ctx, src, filepath.Join(dir, "cancelled.flac"), nil); err == nil {
		t.Error("cancelled conversion finished")
	}
	if _, err := os.Stat(filepath.Join(dir, "cancelled.flac")); err == nil {
		t.Error("cancelled conversion left a file")
	}
}

func readCSV(t *testing.T, p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestTables(t *testing.T) {
	dir := t.TempDir()
	src := write(t, dir, "people.csv", "\xEF\xBB\xBFname;age;city\nAnna;31;Kraków\n\"Bob; Jr\";007;\"New\nYork\"\n")
	convert(t, src, filepath.Join(dir, "people.xlsx"))
	f, err := excelize.OpenFile(filepath.Join(dir, "people.xlsx"))
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := f.GetRows("people")
	if len(rows) != 3 || rows[1][2] != "Kraków" || rows[2][0] != "Bob; Jr" || rows[2][1] != "007" {
		t.Errorf("xlsx rows: %q", rows)
	}
	if typ, _ := f.GetCellType("people", "B2"); typ != excelize.CellTypeNumber && typ != excelize.CellTypeUnset {
		t.Errorf("31 isn't a number: %v", typ)
	}
	f.Close()
	convert(t, filepath.Join(dir, "people.xlsx"), filepath.Join(dir, "back.tsv"))
	if got := readCSV(t, filepath.Join(dir, "back.tsv")); got != "name\tage\tcity\nAnna\t31\tKraków\nBob; Jr\t007\t\"New\nYork\"\n" {
		t.Errorf("xlsx → tsv: %q", got)
	}
	convert(t, src, filepath.Join(dir, "people.json"))
	var recs []map[string]any
	if b, _ := os.ReadFile(filepath.Join(dir, "people.json")); json.Unmarshal(b, &recs) != nil || len(recs) != 2 || recs[0]["age"] != 31.0 || recs[1]["age"] != "007" || recs[1]["city"] != "New\nYork" {
		t.Errorf("csv → json: %v", recs)
	}
	// JSON records → CSV: keys in order of first appearance, gaps empty.
	js := write(t, dir, "list.json", `[{"b": 1, "a": "x"}, {"a": "y", "c": [1, 2], "d": null}, {"b": true}]`)
	convert(t, js, filepath.Join(dir, "list.csv"))
	if got := readCSV(t, filepath.Join(dir, "list.csv")); got != "b,a,c,d\n1,x,,\n,y,\"[1,2]\",\ntrue,,,\n" {
		t.Errorf("json → csv: %q", got)
	}
	if r := convert(t, src, filepath.Join(dir, "people.pdf")); r.Code != "" || pages(t, filepath.Join(dir, "people.pdf")) != 1 {
		t.Errorf("csv → pdf: %+v", r)
	}
}

func TestWorkbooks(t *testing.T) {
	dir := t.TempDir()
	for _, f := range []string{"sheet.xlsx", "sheet.xls", "sheet.ods"} {
		in := filepath.Join("..", "office", "testdata", f)
		bs := office.NewBooks()
		info, err := bs.Open(in)
		if err != nil {
			t.Fatal(err)
		}
		bs.Close(info.ID)
		r := convert(t, in, filepath.Join(dir, f+".csv"))
		if len(info.Sheets) > 1 && (r.Code != "firstSheet" || r.Arg != info.Sheets[0].Name) {
			t.Errorf("%s: %d sheets, result %+v", f, len(info.Sheets), r)
		}
		convert(t, in, filepath.Join(dir, f+".pdf"))
		pages(t, filepath.Join(dir, f+".pdf"))
		if f != "sheet.xlsx" {
			convert(t, in, filepath.Join(dir, f+".xlsx"))
			if _, err := excelize.OpenFile(filepath.Join(dir, f+".xlsx")); err != nil {
				t.Errorf("%s → xlsx: %v", f, err)
			}
		}
	}
}

const note = `---
title: ignored
---
Trip *plan*
===

Some **bold**, *italic*, ***both***, ` + "`code`" + `, ~~gone~~ and a [link](https://example.com "Example").
Same paragraph -- with dashes... and a break\
here. Snake_case_names stay.

- [x] Done
- [ ] Open
  - nested *item*
    continued
- last

3. three
4. four

> Quoted
> text

| A | B |
|---|:-:|
| 1 | a \| b |
| ` + "`x|y`" + ` | **2** |

` + "```go\nfunc main() {}\n```" + `

    indented code

![A picture](pic.png)

---

See [the ref][r], <https://monoform.app>, http://example.org/path. and [[Other note|other]].

[r]: https://ref.example
`

func TestMarkdown(t *testing.T) {
	d := ParseMarkdown(note)
	kinds := make([]BlockKind, len(d.Blocks))
	for i, b := range d.Blocks {
		kinds[i] = b.Kind
	}
	want := []BlockKind{Heading, Para, ListItem, ListItem, ListItem, ListItem, ListItem, ListItem, Quote, Table, Code, Code, Picture, Rule, Para}
	if !reflect.DeepEqual(kinds, want) {
		t.Fatalf("blocks: %v\nwant %v", kinds, want)
	}
	p := d.Blocks[1].Runs
	find := func(text string) Inline {
		for _, r := range p {
			if r.Text == text {
				return r
			}
		}
		t.Errorf("no run %q in %+v", text, p)
		return Inline{}
	}
	if !find("bold").Bold || !find("italic").Italic || r2(find("both")) || !find("code").Code || !find("gone").Strike || find("link").Link != "https://example.com" {
		t.Errorf("inline styles: %+v", p)
	}
	text := runsText(p)
	if !strings.Contains(text, "paragraph – with dashes… and a break\nhere. Snake_case_names stay.") {
		t.Errorf("paragraph text: %q", text)
	}
	if b := d.Blocks[2]; runsText(b.Runs) != "☑ Done" || b.Level != 0 || b.Ordered {
		t.Errorf("task: %+v", b)
	}
	if b := d.Blocks[4]; b.Level != 1 || runsText(b.Runs) != "nested item continued" {
		t.Errorf("nested: %+v", b)
	}
	if b := d.Blocks[6]; !b.Ordered || b.Number != 3 || d.Blocks[7].Number != 4 {
		t.Errorf("numbered: %+v %+v", b, d.Blocks[7])
	}
	if b := d.Blocks[8]; runsText(b.Runs) != "Quoted text" {
		t.Errorf("quote: %+v", b)
	}
	tb := d.Blocks[9]
	if len(tb.Rows) != 3 || runsText(tb.Rows[1][1]) != "a | b" || runsText(tb.Rows[2][0]) != "x|y" || !tb.Rows[2][1][0].Bold {
		t.Errorf("table: %+v", tb.Rows)
	}
	if d.Blocks[10].Text != "func main() {}" || d.Blocks[11].Text != "indented code" {
		t.Errorf("code: %q %q", d.Blocks[10].Text, d.Blocks[11].Text)
	}
	if b := d.Blocks[12]; b.Text != "pic.png" || b.Alt != "A picture" {
		t.Errorf("picture: %+v", b)
	}
	links := map[string]string{}
	for _, r := range d.Blocks[14].Runs {
		if r.Link != "" {
			links[r.Text] = r.Link
		}
	}
	if !reflect.DeepEqual(links, map[string]string{"the ref": "https://ref.example", "https://monoform.app": "https://monoform.app", "http://example.org/path": "http://example.org/path"}) {
		t.Errorf("links: %v", links)
	}
	if !strings.HasSuffix(runsText(d.Blocks[14].Runs), "and other.") {
		t.Errorf("wiki link: %q", runsText(d.Blocks[14].Runs))
	}
}

func r2(r Inline) bool { return !(r.Bold && r.Italic) }

// docText is a document's text and structure, for comparing conversions.
func docText(d *Doc) string {
	var b strings.Builder
	for _, blk := range d.Blocks {
		switch blk.Kind {
		case Table:
			for _, r := range blk.Rows {
				for _, c := range r {
					b.WriteString(runsText(c) + "|")
				}
				b.WriteString("\n")
			}
		case Code:
			b.WriteString("code:" + blk.Text + "\n")
		case Picture:
			b.WriteString("picture:" + blk.Alt + "\n")
		case Rule:
			b.WriteString("---\n")
		default:
			b.WriteString(strings.Repeat(" ", blk.Level) + runsText(blk.Runs) + "\n")
		}
	}
	return b.String()
}

func TestDocumentRoundTrips(t *testing.T) {
	dir := t.TempDir()
	testImage(t, dir)
	src := write(t, dir, "note.md", note)
	orig, _ := readDocument(src, "md")
	want := docText(orig)
	for _, ext := range []string{"docx", "html", "txt", "pdf"} {
		convert(t, src, filepath.Join(dir, "note."+ext))
	}
	// Markdown → Word → Markdown keeps text, structure, links and the picture.
	convert(t, filepath.Join(dir, "note.docx"), filepath.Join(dir, "back.md"))
	back, err := readDocument(filepath.Join(dir, "back.md"), "md")
	if err != nil {
		t.Fatal(err)
	}
	if got := docText(back); got != want {
		t.Errorf("md → docx → md:\n%s\nwant\n%s", got, want)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "back.md")); !strings.Contains(string(b), "[the ref](https://ref.example)") || !strings.Contains(string(b), "**bold**") || !strings.Contains(string(b), "3. three") {
		t.Errorf("back.md:\n%s", b)
	}
	if _, err := os.Stat(filepath.Join(dir, "back files", "picture 1.png")); err != nil {
		t.Errorf("picture not saved next to the Markdown: %v", err)
	}
	// Word → PDF and Word → HTML.
	convert(t, filepath.Join(dir, "note.docx"), filepath.Join(dir, "word.pdf"))
	pages(t, filepath.Join(dir, "word.pdf"))
	convert(t, filepath.Join(dir, "note.docx"), filepath.Join(dir, "word.html"))
	h, _ := os.ReadFile(filepath.Join(dir, "note.html"))
	for _, s := range []string{"<title>Trip plan</title>", "<h1>Trip <em>plan</em></h1>", "<strong>bold</strong>", `<a href="https://example.com">link</a>`, `<ol start="3">`, "<th>A</th>", "<pre><code>func main() {}</code></pre>", `<img src="data:image/png;base64,`, "<blockquote>"} {
		if !strings.Contains(string(h), s) {
			t.Errorf("html lacks %q", s)
		}
	}
	txt, _ := os.ReadFile(filepath.Join(dir, "note.txt"))
	if !strings.Contains(string(txt), "Trip plan\n=========\n") || !strings.Contains(string(txt), "  • nested item continued") {
		t.Errorf("txt:\n%s", txt)
	}
	if n := pages(t, filepath.Join(dir, "note.pdf")); n != 1 {
		t.Errorf("note.pdf: %d pages", n)
	}
	pdfBytes, _ := os.ReadFile(filepath.Join(dir, "note.pdf"))
	if !bytes.Contains(pdfBytes, []byte("FontFile2")) || !bytes.Contains(pdfBytes, []byte("/Outlines")) {
		t.Error("PDF without embedded fonts or outline")
	}
}

func TestPlainText(t *testing.T) {
	dir := t.TempDir()
	// Windows-1252 without a BOM, CRLF, a poem's line breaks.
	src := write(t, dir, "poem.txt", "Caf\xe9 line one\r\nline two\r\n\r\n\r\nSecond stanza\r\n")
	d, err := readDocument(src, "txt")
	if err != nil {
		t.Fatal(err)
	}
	if got := docText(d); got != "Café line one\nline two\nSecond stanza\n" {
		t.Errorf("txt: %q", got)
	}
	convert(t, src, filepath.Join(dir, "poem.docx"))
	convert(t, filepath.Join(dir, "poem.docx"), filepath.Join(dir, "back.txt"))
	if b, _ := os.ReadFile(filepath.Join(dir, "back.txt")); string(b) != "Café line one\nline two\n\nSecond stanza\n" {
		t.Errorf("txt → docx → txt: %q", b)
	}
	// A long document breaks across pages, and text with no glyphs is named.
	var long strings.Builder
	for i := range 400 {
		long.WriteString(strings.Repeat("word ", 30+i%7) + "\n\n")
	}
	long.WriteString("你好 世界\n")
	r := convert(t, write(t, dir, "long.txt", long.String()), filepath.Join(dir, "long.pdf"))
	if n := pages(t, filepath.Join(dir, "long.pdf")); n < 10 {
		t.Errorf("long.pdf: %d pages", n)
	}
	if r.Code != "missingGlyphs" || !strings.Contains(r.Arg, "你") {
		t.Errorf("missing glyphs: %+v", r)
	}
}

func TestOfficeFixtures(t *testing.T) {
	dir := t.TempDir()
	for _, f := range []string{"doc.docx", "doc.odt", "doc.doc"} {
		in := filepath.Join("..", "office", "testdata", f)
		d, err := readDocument(in, Ext(in))
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		if len(d.Blocks) == 0 || strings.TrimSpace(docText(d)) == "" {
			t.Errorf("%s: no text", f)
		}
		d.cleanup()
		for _, ext := range Targets(in) {
			convert(t, in, filepath.Join(dir, f+"."+ext))
		}
	}
}

// An OpenDocument text written like LibreOffice does: automatic styles,
// a numbered list, a heading, a table, a link.
func TestOdt(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "x.odt")
	f, _ := os.Create(p)
	zw := zip.NewWriter(f)
	w, _ := zw.CreateHeader(&zip.FileHeader{Name: "mimetype", Method: zip.Store})
	w.Write([]byte("application/vnd.oasis.opendocument.text"))
	w, _ = zw.Create("content.xml")
	w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:automatic-styles>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Quotations"/>
<text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style>
</office:automatic-styles>
<office:body><office:text>
<text:h text:outline-level="2">Title</text:h>
<text:p>Hello <text:span text:style-name="T1">bold</text:span><text:s text:c="2"/>and <text:a xlink:href="https://example.com">a link</text:a>.<text:note><text:note-body><text:p>footnote</text:p></text:note-body></text:note></text:p>
<text:list text:style-name="L1"><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p><text:list><text:list-item><text:p>inner</text:p></text:list-item></text:list></text:list-item></text:list>
<text:p text:style-name="P1">Said.</text:p>
<table:table><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>
</office:text></office:body></office:document-content>`))
	zw.Close()
	f.Close()
	d, err := readDocument(p, "odt")
	if err != nil {
		t.Fatal(err)
	}
	if got := docText(d); got != "  Title\nHello bold  and a link.\none\ntwo\n inner\nSaid.\na|b|\n" {
		t.Errorf("odt text: %q", got)
	}
	if b := d.Blocks[0]; b.Kind != Heading || b.Level != 2 {
		t.Errorf("heading: %+v", b)
	}
	if !slices.ContainsFunc(d.Blocks[1].Runs, func(r Inline) bool { return r.Bold && r.Text == "bold" }) || !slices.ContainsFunc(d.Blocks[1].Runs, func(r Inline) bool { return r.Link == "https://example.com" }) {
		t.Errorf("runs: %+v", d.Blocks[1].Runs)
	}
	if b := d.Blocks[3]; b.Kind != ListItem || !b.Ordered || b.Number != 2 {
		t.Errorf("list: %+v", b)
	}
	if d.Blocks[5].Kind != Quote {
		t.Errorf("quote: %+v", d.Blocks[5])
	}
}

func TestChunks(t *testing.T) {
	s := strings.Repeat("żółw ", 200) + strings.Repeat("ą", 400)
	parts := chunks(s)
	if strings.Join(parts, "") != s {
		t.Fatal("chunks lost text")
	}
	for _, p := range parts {
		if !strings.HasPrefix(p, "ż") && !strings.HasPrefix(p, "ą") {
			t.Errorf("chunk split a word or a letter: %q", p[:10])
		}
	}
}
