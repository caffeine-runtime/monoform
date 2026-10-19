package office

import (
	"archive/zip"
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
