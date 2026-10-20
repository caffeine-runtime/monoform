package office

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestOdtReadWrite(t *testing.T) {
	pkg, err := ReadOdt("testdata/doc.odt") // made by LibreOffice from scripts/office/doc-od.fodt
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(pkg.Content, "Quarterly report") || pkg.Styles["Heading_20_1"] != "heading 1" || pkg.Styles["Text_20_body"] != "text body" || pkg.TextStyles["Strong"] != "b" {
		t.Fatalf("styles %v", pkg.Styles)
	}
	if decodeStyleName("Heading_20_1") != "Heading 1" || decodeStyleName("A_b") != "A_b" {
		t.Error("style name decoding")
	}
	out := filepath.Join(t.TempDir(), "out.odt")
	edited := strings.Replace(pkg.Content, "Last paragraph.", "Last paragraph, edited.", 1)
	if err := WriteODF(out, "testdata/doc.odt", []byte(edited)); err != nil {
		t.Fatal(err)
	}
	again, err := ReadOdt(out)
	if err != nil || !strings.Contains(again.Content, "edited.") {
		t.Fatalf("rewritten: %v", err)
	}
	if b, err := ReadZipEntry(out, "Pictures/1000000000000018000000108CB3A434.png", 1<<20); err != nil || len(b) == 0 {
		t.Errorf("picture lost: %v", err)
	}
	if err := WriteODF(out, "testdata/doc.odt", []byte("<broken")); err == nil {
		t.Error("malformed content.xml accepted")
	}
	if _, err := ReadOdt("testdata/sheet.ods"); err == nil {
		t.Error("a spreadsheet opened as a text document")
	}
}
