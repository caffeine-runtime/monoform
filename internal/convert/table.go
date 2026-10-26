package convert

import (
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"

	"github.com/caffeine-runtime/monoform/internal/fs"
	"github.com/caffeine-runtime/monoform/internal/office"
)

// sheet is one table: its name and rows of display values.
type sheet struct {
	name string
	rows [][]string
}

// Rows a PDF of a table is cut at: past this it isn't something to print.
const maxPrintRows = 20000

func convertTable(ctx context.Context, src, dst, from, to string) (Result, error) {
	// A workbook the app can open saves as .xlsx directly, formulas and
	// formatting included.
	if to == "xlsx" && (from == "xls" || from == "ods") {
		bs := office.NewBooks()
		info, err := bs.Open(src)
		if err != nil {
			return Result{}, err
		}
		defer bs.Close(info.ID)
		return Result{}, bs.Save(info.ID, dst)
	}
	sheets, err := readTable(src, from)
	if err != nil {
		return Result{}, err
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	var res Result
	switch to {
	case "xlsx":
		return res, writeXlsx(dst, sheets)
	case "pdf":
		d := &Doc{Title: stemOf(src), Landscape: wide(sheets)}
		for _, s := range sheets {
			rows := s.rows
			if len(rows) > maxPrintRows {
				rows = rows[:maxPrintRows]
				res = firstRows(maxPrintRows)
			}
			if len(sheets) > 1 {
				d.Blocks = append(d.Blocks, Block{Kind: Heading, Level: 2, Runs: plain(s.name)})
			}
			d.Blocks = append(d.Blocks, tableBlock(rows))
		}
		missing, err := writePDF(ctx, dst, d)
		if res.Code == "" {
			res = missingGlyphs(missing)
		}
		return res, err
	}
	if len(sheets) > 1 {
		res = firstSheet(sheets[0].name)
	}
	rows := sheets[0].rows
	return res, fs.AtomicWrite(dst, func(w io.Writer) error {
		switch to {
		case "json":
			return writeRecords(w, rows)
		default:
			cw := csv.NewWriter(w)
			if to == "tsv" {
				cw.Comma = '\t'
			}
			if err := cw.WriteAll(rows); err != nil {
				return err
			}
			cw.Flush()
			return cw.Error()
		}
	})
}

func wide(sheets []sheet) bool {
	for _, s := range sheets {
		for _, r := range s.rows[:min(len(s.rows), 200)] {
			if len(r) > 6 {
				return true
			}
		}
	}
	return false
}

func tableBlock(rows [][]string) Block {
	b := Block{Kind: Table}
	for _, r := range rows {
		cells := make([][]Inline, len(r))
		for i, c := range r {
			cells[i] = plain(c)
		}
		b.Rows = append(b.Rows, cells)
	}
	return b
}

func readTable(p, ext string) ([]sheet, error) {
	switch ext {
	case "csv", "tsv":
		rows, err := readDelimited(p, ext == "tsv")
		return []sheet{{name: stemOf(p), rows: rows}}, err
	case "json":
		rows, err := readRecords(p)
		return []sheet{{name: stemOf(p), rows: rows}}, err
	}
	bs := office.NewBooks()
	info, err := bs.Open(p)
	if err != nil {
		return nil, err
	}
	defer bs.Close(info.ID)
	var out []sheet
	for _, s := range info.Sheets {
		rows, err := bs.Rows(info.ID, s.Name, 0, s.Rows, s.Cols)
		if err != nil {
			return nil, err
		}
		out = append(out, sheet{name: s.Name, rows: trimRows(rows)})
	}
	if len(out) == 0 {
		return nil, errors.New("this workbook has no sheets")
	}
	return out, nil
}

// trimRows drops empty cells at the ends of rows and empty rows at the end.
func trimRows(rows [][]string) [][]string {
	for i, r := range rows {
		n := len(r)
		for n > 0 && r[n-1] == "" {
			n--
		}
		rows[i] = r[:n]
	}
	n := len(rows)
	for n > 0 && len(rows[n-1]) == 0 {
		n--
	}
	return rows[:n]
}

// readDelimited reads CSV (the separator guessed from the first lines:
// comma, semicolon, tab or bar) or TSV, UTF-8 with or without a BOM.
func readDelimited(p string, tsv bool) ([][]string, error) {
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	b = bytes.TrimPrefix(b, []byte("\xEF\xBB\xBF"))
	if !utf8.Valid(b) {
		b = latin1(b)
	}
	r := csv.NewReader(bytes.NewReader(b))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	r.Comma = ','
	if tsv {
		r.Comma = '\t'
	} else {
		r.Comma = guessComma(b)
	}
	rows, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	return trimRows(rows), nil
}

func latin1(b []byte) []byte {
	var out bytes.Buffer
	for _, c := range b {
		out.WriteRune(rune(c))
	}
	return out.Bytes()
}

func guessComma(b []byte) rune {
	sc := bufio.NewScanner(bytes.NewReader(b))
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	counts := map[rune]int{}
	for i := 0; i < 5 && sc.Scan(); i++ {
		line := sc.Text()
		for _, c := range []rune{',', ';', '\t', '|'} {
			counts[c] += strings.Count(line, string(c))
		}
	}
	best := ','
	for _, c := range []rune{';', '\t', '|'} {
		if counts[c] > counts[best] {
			best = c
		}
	}
	return best
}

// readRecords reads a JSON list of records (objects, whose keys become the
// header in the order they first appear) or of rows (arrays).
func readRecords(p string) ([][]string, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	dec := json.NewDecoder(bufio.NewReader(f))
	dec.UseNumber()
	notTable := errors.New("this JSON isn't a table: it needs to be a list of records ([{…}, {…}]) or of rows ([[…], […]])")
	if tok, err := dec.Token(); err != nil || tok != json.Delim('[') {
		return nil, notTable
	}
	var header []string
	col := map[string]int{}
	var records [][]string
	objects := false
	for dec.More() {
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, err
		}
		raw = bytes.TrimSpace(raw)
		switch {
		case len(raw) > 0 && raw[0] == '{':
			objects = true
			keys, vals, err := orderedObject(raw)
			if err != nil {
				return nil, err
			}
			row := make([]string, len(header))
			for i, k := range keys {
				j, ok := col[k]
				if !ok {
					j = len(header)
					col[k] = j
					header = append(header, k)
					row = append(row, "")
				}
				row[j] = cellText(vals[i])
			}
			records = append(records, row)
		case len(raw) > 0 && raw[0] == '[':
			var vals []json.RawMessage
			if err := json.Unmarshal(raw, &vals); err != nil {
				return nil, err
			}
			row := make([]string, len(vals))
			for i, v := range vals {
				row[i] = cellText(v)
			}
			records = append(records, row)
		default:
			return nil, notTable
		}
	}
	if !objects {
		return records, nil
	}
	for i, r := range records {
		for len(r) < len(header) {
			r = append(r, "")
		}
		records[i] = r
	}
	return append([][]string{header}, records...), nil
}

func orderedObject(raw []byte) ([]string, []json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if _, err := dec.Token(); err != nil {
		return nil, nil, err
	}
	var keys []string
	var vals []json.RawMessage
	for dec.More() {
		k, err := dec.Token()
		if err != nil {
			return nil, nil, err
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, nil, err
		}
		keys = append(keys, fmt.Sprint(k))
		vals = append(vals, v)
	}
	return keys, vals, nil
}

func cellText(v json.RawMessage) string {
	v = bytes.TrimSpace(v)
	switch {
	case len(v) == 0 || string(v) == "null":
		return ""
	case v[0] == '"':
		var s string
		json.Unmarshal(v, &s)
		return s
	case v[0] == '{' || v[0] == '[':
		var buf bytes.Buffer
		if json.Compact(&buf, v) == nil {
			return buf.String()
		}
	}
	return string(v)
}

var plainNumber = regexp.MustCompile(`^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,15})?$`)

// writeRecords writes rows as a JSON list of records keyed by the first row
// (empty or repeated names become "column N"); numbers stay numbers.
func writeRecords(w io.Writer, rows [][]string) error {
	if len(rows) == 0 {
		_, err := io.WriteString(w, "[]\n")
		return err
	}
	width := 0
	for _, r := range rows {
		width = max(width, len(r))
	}
	names := make([]string, width)
	seen := map[string]bool{}
	for i := range names {
		n := ""
		if i < len(rows[0]) {
			n = strings.TrimSpace(rows[0][i])
		}
		if n == "" || seen[n] {
			n = "column " + strconv.Itoa(i+1)
		}
		seen[n] = true
		names[i] = n
	}
	bw := bufio.NewWriter(w)
	bw.WriteString("[")
	for ri, r := range rows[1:] {
		if ri > 0 {
			bw.WriteString(",")
		}
		bw.WriteString("\n  {")
		for i, name := range names {
			if i > 0 {
				bw.WriteString(", ")
			}
			k, _ := json.Marshal(name)
			bw.Write(k)
			bw.WriteString(": ")
			v := ""
			if i < len(r) {
				v = r[i]
			}
			if plainNumber.MatchString(v) {
				bw.WriteString(v)
			} else {
				s, _ := json.Marshal(v)
				bw.Write(s)
			}
		}
		bw.WriteString("}")
	}
	bw.WriteString("\n]\n")
	return bw.Flush()
}

// writeXlsx writes the sheets to a new workbook; cells that read as plain
// numbers become numbers, everything else text.
func writeXlsx(dst string, sheets []sheet) error {
	f := excelize.NewFile()
	defer f.Close()
	used := map[string]bool{}
	for i, s := range sheets {
		name := sheetName(s.name, used)
		if i == 0 {
			if err := f.SetSheetName("Sheet1", name); err != nil {
				return err
			}
		} else if _, err := f.NewSheet(name); err != nil {
			return err
		}
		sw, err := f.NewStreamWriter(name)
		if err != nil {
			return err
		}
		for r, row := range s.rows {
			vals := make([]any, len(row))
			for c, v := range row {
				vals[c] = v
				if plainNumber.MatchString(v) {
					if n, err := strconv.ParseFloat(v, 64); err == nil {
						vals[c] = n
					}
				}
			}
			cell, _ := excelize.CoordinatesToCellName(1, r+1)
			if err := sw.SetRow(cell, vals); err != nil {
				return err
			}
		}
		if err := sw.Flush(); err != nil {
			return err
		}
	}
	return fs.AtomicWrite(dst, func(w io.Writer) error {
		_, err := f.WriteTo(w)
		return err
	})
}

// sheetName makes a valid, unused Excel sheet name (31 characters, none of
// : \ / ? * [ ]).
func sheetName(s string, used map[string]bool) string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`:\/?*[]`, r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(s))
	if s == "" {
		s = "Sheet"
	}
	if r := []rune(s); len(r) > 31 {
		s = string(r[:31])
	}
	base := s
	for i := 2; used[strings.ToLower(s)]; i++ {
		suffix := fmt.Sprintf(" (%d)", i)
		r := []rune(base)
		s = string(r[:min(len(r), 31-len(suffix))]) + suffix
	}
	used[strings.ToLower(s)] = true
	return s
}
