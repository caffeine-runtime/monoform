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

	"github.com/caffeine-runtime/monoform/internal/fs"
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
	// Set for .ods workbooks: what's needed to write them back as ODS.
	ods *odsDoc
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
	case "ods", "ots":
		if err := b.loadODS(path); err != nil {
			return info, err
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
		if _, ok := b.rows[name]; ok { // .ods: the text the file shows
			continue
		}
		rows, err := b.f.GetRows(name)
		if err != nil {
			return info, err
		}
		b.rows[name] = rows
	}
	// Workbooks written by scripts often store formulas without results;
	// spreadsheet apps calculate those on open, and so does this.
	if b.ods == nil && b.missingResults() {
		b.recalc()
	}
	for _, name := range b.f.GetSheetList() {
		rows := b.rows[name]
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
	b.indexFormulas()
	disp, err := b.setOne(sheet, row, col, input)
	if err != nil {
		return "", err
	}
	if b.hasFormulas() {
		b.needsCalc = true
		b.recalc()
		if rows := b.rows[sheet]; row < len(rows) && col < len(rows[row]) {
			disp = rows[row][col]
		}
	}
	return disp, nil
}

// setOne writes one cell (no recalculation) and returns its displayed value.
func (b *book) setOne(sheet string, row, col int, input string) (string, error) {
	ref, err := excelize.CoordinatesToCellName(col+1, row+1)
	if err != nil {
		return "", err
	}
	f := b.f
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
	return disp, nil
}

// inputOf is what editing a cell shows: "=formula" or its raw value.
func (b *book) inputOf(sheet string, row, col int) string {
	ref, err := excelize.CoordinatesToCellName(col+1, row+1)
	if err != nil {
		return ""
	}
	if fm, _ := b.f.GetCellFormula(sheet, ref); fm != "" {
		return "=" + fm
	}
	raw, _ := b.f.GetCellValue(sheet, ref, excelize.Options{RawCellValue: true})
	return raw
}

// CellEdit is one cell's new (or previous) input.
type CellEdit struct {
	Row   int    `json:"row"`
	Col   int    `json:"col"`
	Value string `json:"value"`
}

// CellRange is an inclusive block of cells (0-based).
type CellRange struct {
	R0 int `json:"r0"`
	C0 int `json:"c0"`
	R1 int `json:"r1"`
	C1 int `json:"c1"`
}

// maxBatch bounds one paste/fill/clear.
const maxBatch = 1_000_000

// SetCells applies a batch (cells to set, ranges to clear) with a single
// recalculation and returns the previous inputs of every cell it changed,
// so the caller can undo it.
func (bs *Books) SetCells(id, sheet string, cells []CellEdit, clear []CellRange) ([]CellEdit, error) {
	b, err := bs.get(id)
	if err != nil {
		return nil, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.indexFormulas()
	type key struct{ r, c int }
	seen := map[key]bool{}
	var old []CellEdit
	set := func(r, c int, v string) error {
		prev := b.inputOf(sheet, r, c)
		if prev == v {
			return nil
		}
		if !seen[key{r, c}] {
			seen[key{r, c}] = true
			old = append(old, CellEdit{r, c, prev})
		}
		_, err := b.setOne(sheet, r, c, v)
		return err
	}
	rows := b.rows[sheet]
	n := len(cells)
	for _, rg := range clear {
		for r := rg.R0; r <= min(rg.R1, len(rows)-1); r++ {
			for c := rg.C0; c <= min(rg.C1, len(rows[r])-1); c++ {
				if n++; n > maxBatch {
					return nil, fmt.Errorf("too many cells at once (more than %d)", maxBatch)
				}
				if rows[r][c] == "" && b.inputOf(sheet, r, c) == "" {
					continue
				}
				if err := set(r, c, ""); err != nil {
					return nil, err
				}
			}
		}
	}
	if len(cells) > maxBatch {
		return nil, fmt.Errorf("too many cells at once (more than %d)", maxBatch)
	}
	for _, e := range cells {
		if e.Row < 0 || e.Col < 0 {
			continue
		}
		if err := set(e.Row, e.Col, e.Value); err != nil {
			return nil, err
		}
	}
	if len(old) > 0 && b.hasFormulas() {
		b.needsCalc = true
		b.recalc()
	}
	return old, nil
}

// Inputs returns the inputs ("=formula" or value) of a block of cells.
func (bs *Books) Inputs(id, sheet string, r0, r1, c0, c1 int) ([][]string, error) {
	b, err := bs.get(id)
	if err != nil {
		return nil, err
	}
	if (r1-r0+1)*(c1-c0+1) > 2*maxBatch {
		return nil, errors.New("selection too large")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	rows := b.rows[sheet]
	out := make([][]string, 0, max(0, r1-r0+1))
	for r := r0; r <= r1; r++ {
		row := make([]string, c1-c0+1)
		if r < len(rows) {
			for c := c0; c <= min(c1, len(rows[r])-1); c++ {
				row[c-c0] = b.inputOf(sheet, r, c)
			}
		}
		out = append(out, row)
	}
	return out, nil
}

// Complete is Excel's AutoComplete: the single text entry in the column that
// starts with what was typed (case-insensitive), or "" if none or several.
func (bs *Books) Complete(id, sheet string, col int, typed string) (string, error) {
	b, err := bs.get(id)
	if err != nil {
		return "", err
	}
	if typed == "" || numberInput.MatchString(strings.TrimSpace(typed)) {
		return "", nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	t := strings.ToLower(typed)
	found := ""
	for _, row := range b.rows[sheet] {
		if col >= len(row) {
			continue
		}
		v := row[col]
		if len(v) <= len(typed) || numberInput.MatchString(strings.TrimSpace(v)) || !strings.HasPrefix(strings.ToLower(v), t) {
			continue
		}
		if found == "" {
			found = v
		} else if !strings.EqualFold(found, v) {
			return "", nil
		}
	}
	return found, nil
}

// extent is how far a sheet's cells reach: its stored dimension (which
// includes formulas whose result was never calculated, cells GetRows leaves
// out at the end of a row) or the rows read, whichever is larger.
func (b *book) extent(sheet string) (rows, cols int) {
	rs := b.rows[sheet]
	rows, cols = len(rs), maxCols(rs)
	if dim, err := b.f.GetSheetDimension(sheet); err == nil {
		if _, end, ok := strings.Cut(dim, ":"); ok {
			if c, r, err := excelize.CellNameToCoordinates(end); err == nil {
				rows, cols = max(rows, r), max(cols, c)
			}
		}
	}
	return rows, cols
}

// indexFormulas finds the formula cells of every sheet (once).
func (b *book) indexFormulas() {
	for _, sheet := range b.f.GetSheetList() {
		if _, done := b.formulas[sheet]; done {
			continue
		}
		var refs []string
		rows, cols := b.extent(sheet)
		if rows*cols <= maxIndexedCells {
			for r := 0; r < rows; r++ {
				for c := 0; c < cols; c++ {
					ref, _ := excelize.CoordinatesToCellName(c+1, r+1)
					if fm, _ := b.f.GetCellFormula(sheet, ref); fm != "" {
						refs = append(refs, ref)
					}
				}
			}
		}
		b.formulas[sheet] = refs
	}
}

// openScanCells bounds the check for missing results when a workbook opens
// (bigger ones are indexed on the first edit, as before).
const openScanCells = 100_000

// missingResults reports whether a formula has no stored result.
func (b *book) missingResults() bool {
	cells := 0
	for _, sheet := range b.f.GetSheetList() {
		r, c := b.extent(sheet)
		cells += r * c
	}
	if cells > openScanCells {
		return false
	}
	b.indexFormulas()
	for sheet, refs := range b.formulas {
		for _, ref := range refs {
			if v, _ := b.f.GetCellValue(sheet, ref, excelize.Options{RawCellValue: true}); v == "" {
				return true
			}
		}
	}
	return false
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
	if b.ods != nil {
		b.ods.insertRow(sheet, row)
	}
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
	if b.ods != nil {
		b.ods.deleteRow(sheet, row)
	}
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
	if b.ods != nil {
		b.ods.addSheet(name)
	}
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
	b.indexFormulas()
	if err := b.f.SetSheetName(from, to); err != nil {
		return err
	}
	// excelize renames the sheet but not references to it in formulas.
	for sheet, refs := range b.formulas {
		name := sheet
		if name == from {
			name = to
		}
		for _, ref := range refs {
			if fm, _ := b.f.GetCellFormula(name, ref); fm != "" {
				if nf := renameSheetRefs(fm, from, to); nf != fm {
					b.f.SetCellFormula(name, ref, nf)
				}
			}
		}
	}
	b.rows[to] = b.rows[from]
	delete(b.rows, from)
	b.formulas[to] = b.formulas[from]
	delete(b.formulas, from)
	if b.ods != nil {
		if t := b.ods.table(from); t != nil {
			t.name = to
		}
	}
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
	if ext == ".ods" || ext == ".ots" {
		if b.ods == nil {
			return errors.New("only spreadsheets opened from .ods files can be saved as .ods; save as .xlsx")
		}
		if err := WriteODF(path, b.ods.src, b.odsContent()); err != nil {
			return err
		}
		b.ods.src = path
		return nil
	}
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

// renameSheetRefs rewrites "Old!A1" and "'Old'!A1" references (outside
// string literals) to the new sheet name.
func renameSheetRefs(f, from, to string) string {
	quote := func(n string) string {
		if reBareSheet.MatchString(n) {
			return n
		}
		return "'" + strings.ReplaceAll(n, "'", "''") + "'"
	}
	forms := []string{"'" + strings.ReplaceAll(from, "'", "''") + "'!"}
	if reBareSheet.MatchString(from) {
		forms = append(forms, from+"!")
	}
	var out strings.Builder
	for i := 0; i < len(f); {
		if f[i] == '"' {
			j := i + 1
			for j < len(f) && !(f[j] == '"' && (j+1 >= len(f) || f[j+1] != '"')) {
				if f[j] == '"' {
					j++
				}
				j++
			}
			out.WriteString(f[i:min(j+1, len(f))])
			i = j + 1
			continue
		}
		matched := false
		if i == 0 || !strings.ContainsRune("_.$'!abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", rune(f[i-1])) {
			for _, form := range forms {
				if strings.HasPrefix(strings.ToLower(f[i:]), strings.ToLower(form)) {
					out.WriteString(quote(to) + "!")
					i += len(form)
					matched = true
					break
				}
			}
		}
		if !matched {
			out.WriteByte(f[i])
			i++
		}
	}
	return out.String()
}
