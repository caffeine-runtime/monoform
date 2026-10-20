package office

import (
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestXlsxEditAndSave(t *testing.T) {
	bs := NewBooks()
	info, err := bs.Open("testdata/sheet.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Sheets) != 2 || info.Sheets[0].Name != "Budget" || info.Sheets[0].Rows != 4 || info.Sheets[0].Cols != 3 || info.SaveAs != "" {
		t.Fatalf("info = %+v", info)
	}
	rows, _ := bs.Rows(info.ID, "Budget", 0, 5, 3)
	if rows[1][0] != "Café ☕" || rows[3][1] != "1212.5" || rows[4][0] != "" {
		t.Fatalf("rows = %q", rows)
	}
	c, _ := bs.Cell(info.ID, "Budget", 3, 1)
	if c.Formula != "SUM(B2:B3)" || c.Input != "=SUM(B2:B3)" {
		t.Fatalf("cell = %+v", c)
	}
	// Edit a value: the formula result follows.
	if _, err := bs.SetCell(info.ID, "Budget", 2, 1, "1300"); err != nil {
		t.Fatal(err)
	}
	if rows, _ := bs.Rows(info.ID, "Budget", 3, 4, 3); rows[0][1] != "1312.5" {
		t.Fatalf("dependent formula not updated after a value edit: %q", rows[0])
	}
	if v, err := bs.SetCell(info.ID, "Budget", 4, 1, "=B4*2"); err != nil || v != "2625" {
		t.Fatalf("formula = %q %v", v, err)
	}
	rows, _ = bs.Rows(info.ID, "Budget", 0, 5, 3)
	if rows[3][1] != "1312.5" {
		t.Fatalf("SUM not recomputed: %q", rows[3])
	}
	bs.SetCell(info.ID, "Budget", 1, 0, "Coffee")
	out := filepath.Join(t.TempDir(), "out.xlsx")
	if err := bs.Save(info.ID, out); err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if v, _ := f.GetCellValue("Budget", "A2"); v != "Coffee" {
		t.Fatalf("A2 = %q", v)
	}
	if v, _ := f.GetCellValue("Budget", "C2"); v == "" {
		t.Fatal("date lost")
	}
	if fm, _ := f.GetCellFormula("Budget", "B5"); fm != "B4*2" {
		t.Fatalf("formula = %q", fm)
	}
	// Cached results are fresh for readers that don't recalculate.
	for ref, want := range map[string]string{"B4": "1312.5", "B5": "2625"} {
		if v, _ := f.GetCellValue("Budget", ref, excelize.Options{RawCellValue: true}); v != want {
			t.Fatalf("cached %s = %q, want %s", ref, v, want)
		}
	}
	if v, _ := f.GetCellValue("Notes", "A1"); v != "Second sheet" {
		t.Fatalf("other sheet = %q", v)
	}
	bs.Close(info.ID)
	if _, err := bs.Rows(info.ID, "Budget", 0, 1, 1); err == nil {
		t.Fatal("closed book still readable")
	}
}

func TestXlsOpensAsXlsx(t *testing.T) {
	bs := NewBooks()
	info, err := bs.Open("testdata/sheet.xls")
	if err != nil {
		t.Fatal(err)
	}
	if info.SaveAs == "" || filepath.Ext(info.SaveAs) != ".xlsx" || info.Note == "" {
		t.Fatalf("info = %+v", info)
	}
	rows, _ := bs.Rows(info.ID, "Budget", 0, 4, 3)
	if rows[1][0] != "Café ☕" || rows[1][1] != "12.5" || rows[1][2] == "" {
		t.Fatalf("rows = %q", rows)
	}
	bs.SetCell(info.ID, "Budget", 0, 0, "Thing")
	out := filepath.Join(t.TempDir(), "converted.xlsx")
	if err := bs.Save(info.ID, out); err != nil {
		t.Fatal(err)
	}
	if err := bs.Save(info.ID, filepath.Join(t.TempDir(), "x.xls")); err == nil {
		t.Fatal("saving .xls allowed")
	}
	f, _ := excelize.OpenFile(out)
	if v, _ := f.GetCellValue("Budget", "A1"); v != "Thing" {
		t.Fatalf("A1 = %q", v)
	}
}

func TestRowsInsertDeleteSheets(t *testing.T) {
	bs := NewBooks()
	info, _ := bs.Open("testdata/sheet.xlsx")
	if err := bs.InsertRow(info.ID, "Budget", 1); err != nil {
		t.Fatal(err)
	}
	rows, _ := bs.Rows(info.ID, "Budget", 0, 3, 3)
	if rows[1][0] != "" || rows[2][0] != "Café ☕" {
		t.Fatalf("after insert %q", rows)
	}
	bs.DeleteRow(info.ID, "Budget", 1)
	rows, _ = bs.Rows(info.ID, "Budget", 0, 2, 3)
	if rows[1][0] != "Café ☕" {
		t.Fatalf("after delete %q", rows)
	}
	if err := bs.AddSheet(info.ID, "New"); err != nil {
		t.Fatal(err)
	}
	if err := bs.RenameSheet(info.ID, "New", "Renamed"); err != nil {
		t.Fatal(err)
	}
	if _, err := bs.SetCell(info.ID, "Renamed", 0, 0, "x"); err != nil {
		t.Fatal(err)
	}
}

func TestSetCellsBatchUndoAndComplete(t *testing.T) {
	bs := NewBooks()
	path := filepath.Join(t.TempDir(), "b.xlsx")
	f := excelize.NewFile()
	f.SetCellValue("Sheet1", "A1", "Warsaw")
	f.SetCellValue("Sheet1", "A2", 1)
	f.SetCellValue("Sheet1", "A3", 2)
	f.SetCellFormula("Sheet1", "B1", "SUM(A2:A3)")
	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	info, err := bs.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	old, err := bs.SetCells(info.ID, "Sheet1", []CellEdit{{1, 0, "10"}, {2, 0, "20"}, {3, 0, "=A2*2"}}, []CellRange{{0, 0, 0, 0}})
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := bs.Rows(info.ID, "Sheet1", 0, 4, 2)
	if rows[0][0] != "" || rows[0][1] != "30" || rows[3][0] != "20" {
		t.Fatalf("after batch: %v", rows)
	}
	in, _ := bs.Inputs(info.ID, "Sheet1", 0, 3, 0, 1)
	if in[0][1] != "=SUM(A2:A3)" || in[3][0] != "=A2*2" {
		t.Fatalf("inputs %v", in)
	}
	// Undo by writing the old inputs back.
	if _, err := bs.SetCells(info.ID, "Sheet1", old, nil); err != nil {
		t.Fatal(err)
	}
	rows, _ = bs.Rows(info.ID, "Sheet1", 0, 4, 2)
	if rows[0][0] != "Warsaw" || rows[0][1] != "3" || rows[3][0] != "" {
		t.Fatalf("after undo: %v (old %v)", rows, old)
	}
	if c, _ := bs.Complete(info.ID, "Sheet1", 0, "wa"); c != "Warsaw" {
		t.Errorf("complete %q", c)
	}
	if c, _ := bs.Complete(info.ID, "Sheet1", 0, "1"); c != "" {
		t.Errorf("numbers don't complete: %q", c)
	}
}
