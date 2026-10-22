package office

import (
	"archive/zip"
	"encoding/base64"
	"io"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadDoc(t *testing.T) {
	paras, err := ReadDoc("testdata/doc.doc")
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(paras, "\n")
	for _, want := range []string{"Quarterly report", "This is the first paragraph with italic and underlined words.", "Second point — zażółć", "A1\tB1", "Last paragraph."} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in:\n%s", want, joined)
		}
	}
	if _, err := ReadDoc("testdata/doc.docx"); err == nil {
		t.Fatal("docx read as doc")
	}
}

func TestDocxRoundTrip(t *testing.T) {
	pkg, err := ReadDocx("testdata/doc.docx")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(pkg.Document, "Quarterly report") {
		t.Fatal("document text missing")
	}
	found := false
	for _, name := range pkg.Styles {
		if strings.HasPrefix(name, "heading 1") {
			found = true
		}
	}
	if !found {
		t.Fatalf("styles = %v", pkg.Styles)
	}
	edited := strings.Replace(pkg.Document, "Last paragraph.", "Edited paragraph &amp; more.", 1)
	out := filepath.Join(t.TempDir(), "out.docx")
	if err := WriteDocx(out, "testdata/doc.docx", edited); err != nil {
		t.Fatal(err)
	}
	again, err := ReadDocx(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(again.Document, "Edited paragraph &amp; more.") {
		t.Fatal("edit not saved")
	}
	// Every other part is copied unchanged.
	a, _ := zip.OpenReader("testdata/doc.docx")
	b, _ := zip.OpenReader(out)
	defer a.Close()
	defer b.Close()
	if len(a.File) != len(b.File) {
		t.Fatalf("parts %d -> %d", len(a.File), len(b.File))
	}
	for i, f := range a.File {
		g := b.File[i]
		if f.Name != g.Name || (f.Name != documentPart && f.CRC32 != g.CRC32) {
			t.Fatalf("part %s changed", f.Name)
		}
	}
	if err := WriteDocx(out, "testdata/doc.docx", "<w:document><unclosed>"); err == nil {
		t.Fatal("malformed XML accepted")
	}
}

func TestNewDocxFromParagraphs(t *testing.T) {
	out := filepath.Join(t.TempDir(), "new.docx")
	doc := ParagraphsToDocument([]string{"Hello <world>", "", "Second & last"})
	if err := WriteDocx(out, "", doc); err != nil {
		t.Fatal(err)
	}
	pkg, err := ReadDocx(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(pkg.Document, "Hello &lt;world&gt;") || pkg.Styles["Heading1"] != "heading 1" {
		t.Fatalf("pkg = %+v", pkg)
	}
}

// Saving list definitions into a document that had none adds the part with
// its content type and relationship; saving again replaces it in place.
func TestDocxAddsParts(t *testing.T) {
	numbering := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"/><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
	part := Part{Name: "word/numbering.xml", Data: base64.StdEncoding.EncodeToString([]byte(numbering)), RelID: "rIdMfNumbering", RelType: "numbering"}
	img := Part{Name: "word/media/mf-1.png", Data: base64.StdEncoding.EncodeToString([]byte("\x89PNG fake")), RelID: "rIdMfImg1", RelType: "image"}
	for _, src := range []string{"testdata/doc.docx", ""} {
		out := filepath.Join(t.TempDir(), "lists.docx")
		doc := ParagraphsToDocument([]string{"one"})
		if err := WriteDocx(out, src, doc, part, img); err != nil {
			t.Fatal(err)
		}
		pkg, err := ReadDocx(out)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(pkg.Numbering, `w:numId="1"`) {
			t.Fatalf("%q: numbering = %q", src, pkg.Numbering)
		}
		var numRel, imgRel bool
		for _, r := range pkg.Rels {
			numRel = numRel || (r.ID == "rIdMfNumbering" && r.Type == "numbering" && r.Target == "word/numbering.xml")
			imgRel = imgRel || (r.ID == "rIdMfImg1" && r.Type == "image" && r.Target == "word/media/mf-1.png")
		}
		if !numRel || !imgRel {
			t.Fatalf("%q: rels = %+v", src, pkg.Rels)
		}
		types, _ := ReadZipEntry(out, "[Content_Types].xml", 1<<20)
		if !strings.Contains(string(types), `PartName="/word/numbering.xml"`) || !strings.Contains(string(types), `Extension="png"`) {
			t.Fatalf("%q: content types = %s", src, types)
		}
		// Again over the result: replaced, not duplicated.
		again := filepath.Join(t.TempDir(), "again.docx")
		if err := WriteDocx(again, out, doc, part); err != nil {
			t.Fatal(err)
		}
		zr, _ := zip.OpenReader(again)
		seen := map[string]int{}
		for _, f := range zr.File {
			seen[f.Name]++
			if f.Name == "word/_rels/document.xml.rels" {
				rc, _ := f.Open()
				b, _ := io.ReadAll(rc)
				rc.Close()
				if strings.Count(string(b), "rIdMfNumbering") != 1 {
					t.Fatalf("relationship duplicated: %s", b)
				}
			}
		}
		zr.Close()
		for name, n := range seen {
			if n != 1 {
				t.Fatalf("%s written %d times", name, n)
			}
		}
	}
	if err := WriteDocx(filepath.Join(t.TempDir(), "x.docx"), "", ParagraphsToDocument(nil), Part{Name: "../evil.xml", Data: ""}); err == nil {
		t.Fatal("a part outside word/ accepted")
	}
}
