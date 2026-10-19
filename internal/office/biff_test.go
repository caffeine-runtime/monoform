package office

import (
	"fmt"
	"strings"
	"testing"
)

func TestReadXls(t *testing.T) {
	sheets, err := ReadXls("testdata/sheet.xls")
	if err != nil {
		t.Fatal(err)
	}
	if len(sheets) != 2 || sheets[0].Name != "Budget" || sheets[1].Name != "Notes" {
		t.Fatalf("sheets = %+v", sheets)
	}
	got := map[string]string{}
	for _, c := range sheets[0].Cells {
		v := c.Str
		switch c.Kind {
		case "number":
			v = FormatNumber(c.Num)
		case "date":
			v = c.Time.Format("2006-01-02")
		case "bool":
			v = fmt.Sprint(c.Bool)
		}
		got[fmt.Sprintf("%d,%d", c.Row, c.Col)] = c.Kind + ":" + v
	}
	want := map[string]string{
		"0,0": "string:Item",
		"1,0": "string:Café ☕",
		"1,1": "number:12.5",
		"1,2": "date:2026-10-19",
		"2,1": "number:1200",
		"3,1": "number:1212.5", // cached formula result
		"3,2": "number:1",      // LibreOffice stores booleans in .xls as 1 with a TRUE/FALSE format
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("cell %s = %q, want %q", k, got[k], v)
		}
	}
	notes := sheets[1].Cells
	if len(notes) != 2 || notes[1].Num != -3.25 {
		t.Fatalf("notes = %+v", notes)
	}
}

func TestReadXlsRejectsOtherFiles(t *testing.T) {
	if _, err := ReadXls("testdata/sheet.xlsx"); err == nil {
		t.Fatal("xlsx read as xls")
	}
	if _, err := ReadXls("testdata/missing.xls"); err == nil {
		t.Fatal("missing file")
	}
}

func TestRK(t *testing.T) {
	// 1.5 as float RK, 100 as int RK, 1.23 as int*100 RK
	if v := rk(0x3FF80000); v != 1.5 {
		t.Errorf("float rk = %v", v)
	}
	if v := rk(100<<2 | 2); v != 100 {
		t.Errorf("int rk = %v", v)
	}
	if v := rk(123<<2 | 3); v != 1.23 {
		t.Errorf("int/100 rk = %v", v)
	}
}

func TestDateFormat(t *testing.T) {
	for _, f := range []string{"yyyy-mm-dd", "d/m/yy h:mm", "[$-409]mmmm d, yyyy"} {
		if !dateFormat(f) {
			t.Errorf("%q should be a date", f)
		}
	}
	for _, f := range []string{"0.00", "#,##0", `"days"0`, "General", ""} {
		if dateFormat(f) {
			t.Errorf("%q should not be a date", f)
		}
	}
	if !strings.HasPrefix(excelTime(45949, false).Format("2006-01-02"), "2025-10-19") {
		t.Errorf("serial 45949 = %v", excelTime(45949, false))
	}
}
