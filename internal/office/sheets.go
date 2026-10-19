// Package office opens, edits and saves spreadsheets (.xlsx natively via
// excelize; legacy .xls is read and saved as .xlsx) and Word documents
// (.docx package handling; legacy .doc text is converted to .docx).
package office

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/xuri/excelize/v2"

	"github.com/caffeine-runtime/hold-it-all/internal/fs"
)

type SheetInfo struct {
	Name string `json:"name"`
	Rows int    `json:"rows"`
	Cols int    `json:"cols"`
}

type BookInfo struct {
	ID     string      `json:"id"`
	Format string      `json:"format"` // "xlsx", "xlsm", "xls"
	Sheets []SheetInfo `json:"sheets"`
	// SaveAs is set when the original format can't be written back; saving
	// then creates this .xlsx file instead.
	SaveAs string `json:"saveAs"`
	Note   string `json:"note"`
}

type CellInfo struct {
	Value   string `json:"value"`   // displayed (formatted) value
	Formula string `json:"formula"` // without the leading "="
	Input   string `json:"input"`   // what to show when editing
}

type book struct {
	mu     sync.Mutex
	f      *excelize.File
	format string
	rows   map[string][][]string // display cache per sheet
	// Formula cells per sheet (built lazily on the first edit), recomputed
	// after every edit so dependent values update like in a spreadsheet app.
	formulas map[string][]string
	// Set once any edit touches a workbook with formulas: Excel/LibreOffice
	// then recalculate cached results when the file is opened.
	needsCalc bool
}

// maxIndexedCells bounds the formula scan; huge sheets skip live recalculation.
const maxIndexedCells = 500_000

// Books holds open workbooks by id.
type Books struct {
	mu   sync.Mutex
	seq  int
	open map[string]*book
}

func NewBooks() *Books { return &Books{open: map[string]*book{}} }

// Open loads a workbook. .xls files are converted in memory.
func (bs *Books) Open(path string) (BookInfo, error) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	b := &book{format: ext, rows: map[string][][]string{}, formulas: map[string][]string{}}
	info := BookInfo{Format: ext}
	switch ext {
	case "xlsx", "xlsm", "xltx", "xltm":
		f, err := excelize.OpenFile(path)
		if err != nil {
			return info, fmt.Errorf("could not open workbook: %w", err)
		}
		b.f = f
		if ext == "xlsm" || ext == "xltm" {
			info.Note = "Macros are kept as they are but never run."
		}
	case "xls":
		sheets, err := ReadXls(path)
		if err != nil {
			return info, err
		}
		f, err := fromXls(sheets)
		if err != nil {
			return info, err
		}
		b.f = f
		info.SaveAs = strings.TrimSuffix(path, filepath.Ext(path)) + ".xlsx"
		info.Note = "Legacy .xls: values are editable, and saving creates a new .xlsx next to it (formulas and formatting from the .xls are not carried over)."
	default:
		return info, fmt.Errorf("unsupported spreadsheet type .%s", ext)
	}
	for _, name := range b.f.GetSheetList() {
		rows, err := b.f.GetRows(name)
		if err != nil {
			return info, err
		}
		b.rows[name] = rows
		info.Sheets = append(info.Sheets, SheetInfo{Name: name, Rows: len(rows), Cols: maxCols(rows)})
	}
	bs.mu.Lock()
	bs.seq++
	info.ID = fmt.Sprintf("book-%d", bs.seq)
	bs.open[info.ID] = b
	bs.mu.Unlock()
	return info, nil
}

func maxCols(rows [][]string) int {
	n := 0
	for _, r := range rows {
		n = max(n, len(r))
	}
	return n
}

func fromXls(sheets []XlsSheet) (*excelize.File, error) {
	f := excelize.NewFile()
	dateStyle, _ := f.NewStyle(&excelize.Style{NumFmt: 14})
	for i, sh := range sheets {
		name := sh.Name
		if name == "" {
			name = fmt.Sprintf("Sheet%d", i+1)
		}
		if i == 0 {
			if err := f.SetSheetName("Sheet1", name); err != nil {
				return nil, err
			}
		} else if _, err := f.NewSheet(name); err != nil {
			return nil, err
		}
		for _, c := range sh.Cells {
			ref, err := excelize.CoordinatesToCellName(c.Col+1, c.Row+1)
			if err != nil {
				continue
			}
			switch c.Kind {
			case "number":
				f.SetCellFloat(name, ref, c.Num, -1, 64)
			case "date":
				f.SetCellFloat(name, ref, c.Num, -1, 64)
				f.SetCellStyle(name, ref, ref, dateStyle)
			case "bool":
				f.SetCellBool(name, ref, c.Bool)
			default:
				f.SetCellStr(name, ref, c.Str)
			}
		}
	}
	return f, nil
}

func (bs *Books) get(id string) (*book, error) {
	bs.mu.Lock()
	defer bs.mu.Unlock()
	b := bs.open[id]
	if b == nil {
		return nil, errors.New("workbook is not open")
	}
	return b, nil
}

// Rows returns display values for rows [start, end) of a sheet, each padded
// to cols cells.
func (bs *Books) Rows(id, sheet string, start, end, cols int) ([][]string, error) {
	b, err := bs.get(id)
	if err != nil {
		return nil, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	rows := b.rows[sheet]
	out := make([][]string, 0, max(0, end-start))
	for r := start; r < end; r++ {
		row := make([]string, cols)
		if r < len(rows) {
			copy(row, rows[r])
		}
		out = append(out, row)
	}
	return out, nil
}

// Cell returns the value and formula of one cell (0-based row/col).
func (bs *Books) Cell(id, sheet string, row, col int) (CellInfo, error) {
	b, err := bs.get(id)
	if err != nil {
		return CellInfo{}, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	ref, err := excelize.CoordinatesToCellName(col+1, row+1)
	if err != nil {
		return CellInfo{}, err
	}
	formula, _ := b.f.GetCellFormula(sheet, ref)
	raw, _ := b.f.GetCellValue(sheet, ref, excelize.Options{RawCellValue: true})
	disp := ""
	if rows := b.rows[sheet]; row < len(rows) && col < len(rows[row]) {
		disp = rows[row][col]
	}
	input := raw
	if formula != "" {
		input = "=" + formula
	}
	return CellInfo{Value: disp, Formula: formula, Input: input}, nil
}

var numberInput = regexp.MustCompile(`^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$`)

// SetCell parses input like a spreadsheet would ("=..." formula, number,
// TRUE/FALSE, otherwise text) and returns the new displayed value.
func (bs *Books) SetCell(id, sheet string, row, col int, input string) (string, error) {
	b, err := bs.get(id)
	if err != nil {
		return "", err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	ref, err := excelize.CoordinatesToCellName(col+1, row+1)
	if err != nil {
		return "", err
	}
	f := b.f
	b.indexFormulas()
	switch {
	case strings.HasPrefix(input, "=") && len(input) > 1:
		if err := f.SetCellFormula(sheet, ref, input[1:]); err != nil {
			return "", err
		}
		b.addFormula(sheet, ref)
	case input == "":
		if err := f.SetCellValue(sheet, ref, nil); err != nil {
			return "", err
		}
		b.dropFormula(sheet, ref)
	case numberInput.MatchString(strings.TrimSpace(input)):
		v, _ := strconv.ParseFloat(strings.TrimSpace(input), 64)
		if err := f.SetCellFloat(sheet, ref, v, -1, 64); err != nil {
			return "", err
		}
		b.dropFormula(sheet, ref)
	case strings.EqualFold(input, "true") || strings.EqualFold(input, "false"):
		if err := f.SetCellBool(sheet, ref, strings.EqualFold(input, "true")); err != nil {
			return "", err
		}
		b.dropFormula(sheet, ref)
	default:
		if err := f.SetCellStr(sheet, ref, input); err != nil {
			return "", err
		}
		b.dropFormula(sheet, ref)
	}
	disp, _ := f.GetCellValue(sheet, ref)
	b.setCached(sheet, row, col, disp)
	if b.hasFormulas() {
		b.needsCalc = true
		b.recalc()
		if rows := b.rows[sheet]; row < len(rows) && col < len(rows[row]) {
			disp = rows[row][col]
		}
	}
	return disp, nil
}

// indexFormulas finds the formula cells of every sheet (once).
func (b *book) indexFormulas() {
	for _, sheet := range b.f.GetSheetList() {
		if _, done := b.formulas[sheet]; done {
			continue
		}
		var refs []string
		rows := b.rows[sheet]
		cells := 0
		for r, row := range rows {
			cells += len(row)
			if cells > maxIndexedCells {
				refs = nil
				break
			}
			for c := range row {
				ref, _ := excelize.CoordinatesToCellName(c+1, r+1)
				if fm, _ := b.f.GetCellFormula(sheet, ref); fm != "" {
					refs = append(refs, ref)
				}
			}
		}
		b.formulas[sheet] = refs
	}
}

func (b *book) hasFormulas() bool {
	for _, refs := range b.formulas {
		if len(refs) > 0 {
			return true
		}
	}
	return false
}

func (b *book) addFormula(sheet, ref string) {
	for _, r := range b.formulas[sheet] {
		if r == ref {
			return
		}
	}
	b.formulas[sheet] = append(b.formulas[sheet], ref)
}

func (b *book) dropFormula(sheet, ref string) {
	refs := b.formulas[sheet]
	for i, r := range refs {
		if r == ref {
			b.formulas[sheet] = append(refs[:i], refs[i+1:]...)
			return
		}
	}
}

// recalc recomputes every indexed formula cell and updates the display cache.
// Two passes settle formulas that depend on other formulas in later cells.
func (b *book) recalc() {
	for pass := 0; pass < 2; pass++ {
		for sheet, refs := range b.formulas {
			for _, ref := range refs {
				v, err := b.f.CalcCellValue(sheet, ref)
				if err != nil {
					continue
				}
				col, row, err := excelize.CellNameToCoordinates(ref)
				if err != nil {
					continue
				}
				b.setCached(sheet, row-1, col-1, v)
			}
		}
	}
}

func (b *book) setCached(sheet string, row, col int, v string) {
	rows := b.rows[sheet]
	for len(rows) <= row {
		rows = append(rows, []string{})
	}
	for len(rows[row]) <= col {
		rows[row] = append(rows[row], "")
	}
	rows[row][col] = v
	b.rows[sheet] = rows
}

// InsertRow inserts an empty row before row (0-based).
func (bs *Books) InsertRow(id, sheet string, row int) error {
	b, err := bs.get(id)
	if err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.f.InsertRows(sheet, row+1, 1); err != nil {
		return err
	}
	delete(b.formulas, sheet) // references moved; re-index on next edit
	rows := b.rows[sheet]
	if row <= len(rows) {
		rows = append(rows[:row], append([][]string{{}}, rows[row:]...)...)
	}
	b.rows[sheet] = rows
	return nil
}

// DeleteRow removes row (0-based).
func (bs *Books) DeleteRow(id, sheet string, row int) error {
	b, err := bs.get(id)
	if err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.f.RemoveRow(sheet, row+1); err != nil {
		return err
	}
	delete(b.formulas, sheet)
	rows := b.rows[sheet]
	if row < len(rows) {
		b.rows[sheet] = append(rows[:row], rows[row+1:]...)
	}
	return nil
}

// AddSheet appends an empty sheet.
func (bs *Books) AddSheet(id, name string) error {
	b, err := bs.get(id)
	if err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, err := b.f.NewSheet(name); err != nil {
		return err
	}
	b.rows[name] = [][]string{}
	return nil
}

// RenameSheet renames a sheet.
func (bs *Books) RenameSheet(id, from, to string) error {
	b, err := bs.get(id)
	if err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.f.SetSheetName(from, to); err != nil {
		return err
	}
	b.rows[to] = b.rows[from]
	delete(b.rows, from)
	b.formulas[to] = b.formulas[from]
	delete(b.formulas, from)
	return nil
}

// Save writes the workbook as .xlsx/.xlsm to path atomically.
func (bs *Books) Save(id, path string) error {
	b, err := bs.get(id)
	if err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".xlsx" && ext != ".xlsm" && ext != ".xltx" && ext != ".xltm" {
		return errors.New("spreadsheets are saved as .xlsx")
	}
	if b.needsCalc {
		// Ask Excel/LibreOffice to recalculate cached formula results on open.
		yes := true
		b.f.SetCalcProps(&excelize.CalcPropsOptions{FullCalcOnLoad: &yes})
	}
	return fs.AtomicWrite(path, func(w io.Writer) error {
		if b.needsCalc {
			return b.writeWithCachedResults(w)
		}
		_, err := b.f.WriteTo(w)
		return err
	})
}

// Close releases a workbook.
func (bs *Books) Close(id string) {
	bs.mu.Lock()
	b := bs.open[id]
	delete(bs.open, id)
	bs.mu.Unlock()
	if b != nil {
		b.f.Close()
	}
}
