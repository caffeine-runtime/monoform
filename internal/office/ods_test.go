package office

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func odsPart(t *testing.T, p, name string) string {
	t.Helper()
	b, err := ReadZipEntry(p, name, 64<<20)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestODSOpenEditSave(t *testing.T) {
	bs := NewBooks()
	info, err := bs.Open("testdata/sheet.ods") // made by LibreOffice from scripts/office/sheet-od.fods
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Sheets) != 2 || info.Sheets[0].Name != "Budget" || info.Sheets[1].Name != "Notes" || info.Sheets[0].Rows != 6 {
		t.Fatalf("info = %+v", info)
	}
	rows, _ := bs.Rows(info.ID, "Budget", 0, 6, 4)
	if rows[1][0] != "Café  ☕" || rows[1][1] != "12.50 €" || rows[1][3] != "1%" || rows[4][0] != "Merged note" || strings.Join(rows[5], ",") != "7,7,7," {
		t.Fatalf("display = %q", rows)
	}
	for _, c := range []struct {
		r, c int
		in   string
	}{{3, 1, "=SUM(B2:B3)"}, {1, 3, "=B2/B4"}, {4, 2, "=Notes!B2*2"}, {2, 1, "1200"}, {3, 2, "1"}} {
		if got, _ := bs.Cell(info.ID, "Budget", c.r, c.c); got.Input != c.in {
			t.Errorf("cell %d,%d input %q, want %q", c.r, c.c, got.Input, c.in)
		}
	}
	// Edit a value: the total follows; insert a row inside the summed range.
	if _, err := bs.SetCell(info.ID, "Budget", 2, 1, "1300"); err != nil {
		t.Fatal(err)
	}
	if rows, _ := bs.Rows(info.ID, "Budget", 3, 4, 4); rows[0][1] != "1312.5" {
		t.Fatalf("total not recalculated: %q", rows[0])
	}
	if err := bs.InsertRow(info.ID, "Budget", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := bs.SetCell(info.ID, "Budget", 2, 0, "Insurance  (new)"); err != nil {
		t.Fatal(err)
	}
	if _, err := bs.SetCell(info.ID, "Budget", 2, 1, "87.5"); err != nil {
		t.Fatal(err)
	}
	if _, err := bs.SetCell(info.ID, "Budget", 9, 6, "far away"); err != nil { // beyond the data
		t.Fatal(err)
	}
	if err := bs.RenameSheet(info.ID, "Notes", "Notes & more"); err != nil {
		t.Fatal(err)
	}
	if err := bs.AddSheet(info.ID, "Extra"); err != nil {
		t.Fatal(err)
	}
	if _, err := bs.SetCell(info.ID, "Extra", 0, 0, "hello"); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "out.ods")
	if err := bs.Save(info.ID, out); err != nil {
		t.Fatal(err)
	}
	if err := bs.Save(info.ID, filepath.Join(t.TempDir(), "x.xlsx")); err != nil {
		t.Errorf("an .ods can still be saved as .xlsx: %v", err)
	}
	bs.Close(info.ID)

	// The package: mimetype first and stored, other parts kept.
	zr, err := zip.OpenReader(out)
	if err != nil {
		t.Fatal(err)
	}
	if f := zr.File[0]; f.Name != "mimetype" || f.Method != zip.Store {
		t.Errorf("first entry %s method %d", f.Name, f.Method)
	}
	zr.Close()
	if odsPart(t, out, "styles.xml") != odsPart(t, "testdata/sheet.ods", "styles.xml") {
		t.Error("styles.xml changed")
	}
	content := odsPart(t, out, "content.xml")
	for _, want := range []string{
		`<table:table-cell office:value-type="string" calcext:value-type="string"><text:p>Rent</text:p></table:table-cell>`, // untouched: byte for byte
		`<dc:creator>Ann</dc:creator>`,     // comment kept
		`table:number-columns-spanned="2"`, // merge kept
		`<table:covered-table-cell table:style-name="Default"/>`,
		`<table:table-header-rows><table:table-row`, // header rows stay in their container
		`table:formula="of:=SUM([.B2:.B4])" office:value-type="currency" office:value="1400" office:currency="EUR"`,
		`office:value-type="currency" office:value="1300" office:currency="EUR"`,
		`<text:p>Insurance <text:s/>(new)</text:p>`,
		`table:formula="of:=[$'Notes &amp; more'.B2]*2"`,
		`table:name="Notes &amp; more"`,
		`table:name="Extra"`,
		`<text:p>far away</text:p>`,
		`table:style-name="ceBold"`,
	} {
		if !strings.Contains(content, want) {
			t.Errorf("content.xml lacks %s", want)
		}
	}

	// It opens again with the edits.
	bs2 := NewBooks()
	info2, err := bs2.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer bs2.Close(info2.ID)
	if len(info2.Sheets) != 3 || info2.Sheets[1].Name != "Notes & more" {
		t.Fatalf("reopened sheets %+v", info2.Sheets)
	}
	rows, _ = bs2.Rows(info2.ID, "Budget", 0, 10, 7)
	if rows[2][0] != "Insurance  (new)" || rows[3][1] != "1,200.00 €" && rows[3][1] != "1300" || rows[9][6] != "far away" {
		t.Fatalf("reopened rows %q", rows)
	}
	if c, _ := bs2.Cell(info2.ID, "Budget", 4, 1); c.Input != "=SUM(B2:B4)" {
		t.Errorf("total formula %q", c.Input)
	}
	if c, _ := bs2.Cell(info2.ID, "Budget", 5, 2); c.Input != "='Notes & more'!B2*2" {
		t.Errorf("cross-sheet formula %q", c.Input)
	}
}

func TestODSTails(t *testing.T) {
	// LibreOffice writes the rest of a sheet as one repeated empty row of
	// repeated empty cells; those stay single elements, with their counts
	// reduced as cells and rows are added.
	content := []byte(`<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet>` +
		`<table:table table:name="S"><table:table-column table:number-columns-repeated="1024"/>` +
		`<table:table-row table:style-name="ro1"><table:table-cell office:value-type="float" office:value="1"><text:p>1</text:p></table:table-cell><table:table-cell table:style-name="ce9" table:number-columns-repeated="1023"/></table:table-row>` +
		`<table:table-row table:number-rows-repeated="1048575"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>` +
		`</table:table></office:spreadsheet></office:body></office:document-content>`)
	doc, err := parseODS(content)
	if err != nil {
		t.Fatal(err)
	}
	tb := doc.tables[0]
	if len(tb.rows) != 1 || tb.tailN != 1048575 || len(tb.rows[0].cells) != 1 || tb.rows[0].tailN != 1023 {
		t.Fatalf("rows %d tail %d cells %d rowtail %d", len(tb.rows), tb.tailN, len(tb.rows[0].cells), tb.rows[0].tailN)
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "t.ods")
	writeTestODS(t, p, content)
	bs := NewBooks()
	info, err := bs.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	bs.SetCell(info.ID, "S", 0, 2, "x")
	bs.SetCell(info.ID, "S", 2, 0, "y")
	if err := bs.Save(info.ID, p); err != nil { // over itself
		t.Fatal(err)
	}
	out := odsPart(t, p, "content.xml")
	for _, want := range []string{
		`<table:table-cell table:style-name="ce9"/><table:table-cell table:style-name="ce9" office:value-type="string"><text:p>x</text:p></table:table-cell><table:table-cell table:style-name="ce9" table:number-columns-repeated="1021"/>`,
		`<table:table-row table:number-rows-repeated="1048573">`,
		`<text:p>y</text:p>`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %s in %s", want, out)
		}
	}
}

func writeTestODS(t *testing.T, p string, content []byte) {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.CreateHeader(&zip.FileHeader{Name: "mimetype", Method: zip.Store})
	w.Write([]byte(mimeODS))
	w, _ = zw.Create("content.xml")
	w.Write(content)
	zw.Close()
	if err := os.WriteFile(p, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestOpenFormulaConversion(t *testing.T) {
	for _, c := range []struct{ of, xl string }{
		{"of:=SUM([.A1:.B2];[$Sheet2.C3])", "SUM(A1:B2,Sheet2!C3)"},
		{"of:=[$'My Sheet'.$A$1]+[.B1]", "'My Sheet'!$A$1+B1"},
		{`of:=IF([.A1]>0;"a;[b]";LOG10([.B1]))`, `IF(A1>0,"a;[b]",LOG10(B1))`},
		{`of:=CONCATENATE("say ""hi"";";[.C2])`, `CONCATENATE("say ""hi"";",C2)`},
		{"of:=[$Data.A1:.A10]", "Data!A1:A10"},
	} {
		got, ok := toExcelFormula(c.of)
		if !ok || got != c.xl {
			t.Errorf("toExcel(%s) = %s", c.of, got)
		}
		if back := "of:=" + toOpenFormula(c.xl); back != strings.Replace(c.of, "[$Data.A1:.A10]", "[$Data.A1:.A10]", 1) && back != c.of {
			t.Errorf("toOpen(%s) = %s, want %s", c.xl, back, c.of)
		}
	}
	if _, ok := toExcelFormula("ooow:=x"); ok {
		t.Error("unknown formula language accepted")
	}
}

func TestODFEncryptedRefused(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.CreateHeader(&zip.FileHeader{Name: "mimetype", Method: zip.Store})
	w.Write([]byte(mimeODS))
	w, _ = zw.Create("META-INF/manifest.xml")
	w.Write([]byte(`<manifest:manifest><manifest:file-entry manifest:full-path="content.xml"><manifest:encryption-data/></manifest:file-entry></manifest:manifest>`))
	w, _ = zw.Create("content.xml")
	w.Write([]byte("garbage"))
	zw.Close()
	p := filepath.Join(t.TempDir(), "locked.ods")
	os.WriteFile(p, buf.Bytes(), 0o644)
	if _, err := NewBooks().Open(p); err == nil || !strings.Contains(err.Error(), "password") {
		t.Errorf("err = %v", err)
	}
}
