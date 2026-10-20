package office

// ODS spreadsheets are loaded into an in-memory excelize workbook, so
// editing, formulas and recalculation work exactly as for .xlsx, and are
// written back as ODS. Saving regenerates only the rows of content.xml:
// cells that weren't edited are copied byte for byte, edited ones get their
// new value with their original style, spans, comments and anchored shapes.
// Everything else (styles, column definitions, charts, named ranges, the
// other parts of the package) is kept as it is.

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

const (
	maxODSCols  = 16384
	maxODSCells = 5_000_000 // expanded cells (repeats included) per workbook
)

type odsCell struct {
	raw       []byte // the original element without its repeat count; nil for new cells
	rawRepeat []byte // the original element as written
	covered   bool   // table:covered-table-cell (hidden by a merge)
	empty     bool
	style     string
	colSpan   string
	rowSpan   string
	extra     []byte // children other than paragraphs: comments, anchored shapes
	vtype     string // office:value-type
	currency  string
	value     string // office:value / date-value / time-value / boolean-value
	formula   string // as written in the file ("of:=SUM([.A1:.A2])")
	text      string // displayed text
	input     string // the cell's input after loading; another input means it was edited
}

type odsRow struct {
	start  []byte // start tag without its repeat count
	cells  []*odsCell
	tail   []byte // the row's trailing run of empty cells, kept as one element
	tailN  int
	run    int // which run of rows (between raw chunks) this row belongs to
	repeat int
	raw    []byte
}

type odsTable struct {
	name      string
	start     []byte
	chunks    [][]byte // raw XML around the runs of rows: chunks[0], run 0, chunks[1], run 1, …
	rows      []*odsRow
	tail      []byte // the table's trailing run of empty rows
	tailN     int
	tailRun   int
	origTotal int // rows including the tail, as loaded
}

type odsDoc struct {
	src     string
	head    []byte // content.xml before the first table
	between [][]byte
	foot    []byte
	tables  []*odsTable // in file order; added sheets are appended
	pfx     map[string]string
}

func (d *odsDoc) table(name string) *odsTable {
	for _, t := range d.tables {
		if t.name == name {
			return t
		}
	}
	return nil
}

func attr(se xml.StartElement, space, local string) string {
	for _, a := range se.Attr {
		if a.Name.Space == space && a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

var (
	reColsRepeat = regexp.MustCompile(`\s[\w.-]+:number-columns-repeated="[^"]*"`)
	reRowsRepeat = regexp.MustCompile(`\s[\w.-]+:number-rows-repeated="[^"]*"`)
	reTableName  = regexp.MustCompile(`(\s[\w.-]+:name=")[^"]*(")`)
	reSpace      = regexp.MustCompile(`[ \t\r\n]+`)
)

// parseODS splits content.xml into the parts kept verbatim and the cells.
func parseODS(content []byte) (*odsDoc, error) {
	doc := &odsDoc{pfx: map[string]string{nsTable: "table", nsOffice: "office", nsText: "text"}}
	d := xml.NewDecoder(bytes.NewReader(content))
	var spans [][2]int64
	root := true
	cells := 0
	for {
		start := d.InputOffset()
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("content.xml: %w", err)
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		if root {
			root = false
			for _, a := range se.Attr {
				if a.Name.Space == "xmlns" {
					doc.pfx[a.Value] = a.Name.Local
				}
			}
		}
		if se.Name.Space == nsTable && se.Name.Local == "table" {
			t, err := parseTable(d, content, se, start, &cells)
			if err != nil {
				return nil, err
			}
			doc.tables = append(doc.tables, t)
			spans = append(spans, [2]int64{start, d.InputOffset()})
		}
	}
	if len(spans) == 0 {
		return nil, errors.New("the spreadsheet has no sheets")
	}
	doc.head = content[:spans[0][0]]
	for i := 1; i < len(spans); i++ {
		doc.between = append(doc.between, content[spans[i-1][1]:spans[i][0]])
	}
	doc.foot = content[spans[len(spans)-1][1]:]
	return doc, nil
}

func parseTable(d *xml.Decoder, content []byte, se xml.StartElement, start int64, cells *int) (*odsTable, error) {
	t := &odsTable{name: attr(se, nsTable, "name"), start: content[start:d.InputOffset()]}
	rawFrom := d.InputOffset()
	var rows []*odsRow
	for depth := 1; depth > 0; {
		s := d.InputOffset()
		tok, err := d.Token()
		if err != nil {
			return nil, fmt.Errorf("content.xml: %w", err)
		}
		switch tk := tok.(type) {
		case xml.StartElement:
			if tk.Name.Space == nsTable && tk.Name.Local == "table-row" {
				if len(t.chunks) == 0 || s > rawFrom {
					t.chunks = append(t.chunks, content[rawFrom:s])
				}
				r, err := parseRow(d, content, tk, s, cells)
				if err != nil {
					return nil, err
				}
				r.run = len(t.chunks) - 1
				rows = append(rows, r)
				rawFrom = d.InputOffset()
				continue
			}
			depth++
		case xml.EndElement:
			depth--
		}
	}
	last := content[rawFrom:d.InputOffset()]
	if len(t.chunks) == 0 {
		// No rows: open a run just before the end tag for rows added later.
		i := bytes.LastIndex(last, []byte("</"))
		t.chunks = append(t.chunks, last[:i])
		last = last[i:]
	}
	t.chunks = append(t.chunks, last)
	// A trailing run of empty rows (LibreOffice writes one reaching the last
	// row of the sheet) stays a single element; other repeats are expanded.
	if n := len(rows); n > 0 && rows[n-1].repeat > 1 && rowEmpty(rows[n-1]) {
		tr := rows[n-1]
		t.tail, t.tailN, t.tailRun = tr.raw, tr.repeat, tr.run
		rows = rows[:n-1]
	}
	for _, r := range rows {
		for i := 0; i < r.repeat; i++ {
			if i == 0 {
				t.rows = append(t.rows, r)
				continue
			}
			if *cells += len(r.cells); *cells > maxODSCells {
				return nil, errors.New("the spreadsheet is too large to open")
			}
			c := *r
			c.cells = make([]*odsCell, len(r.cells))
			for j, x := range r.cells {
				cc := *x
				c.cells[j] = &cc
			}
			t.rows = append(t.rows, &c)
		}
	}
	t.origTotal = len(t.rows) + t.tailN
	return t, nil
}

func rowEmpty(r *odsRow) bool {
	for _, c := range r.cells {
		if !c.empty {
			return false
		}
	}
	return true
}

func parseRow(d *xml.Decoder, content []byte, se xml.StartElement, s int64, cells *int) (*odsRow, error) {
	r := &odsRow{repeat: 1}
	if n, err := strconv.Atoi(attr(se, nsTable, "number-rows-repeated")); err == nil && n > 1 {
		r.repeat = n
	}
	st := reRowsRepeat.ReplaceAll(content[s:d.InputOffset()], nil)
	if bytes.HasSuffix(st, []byte("/>")) {
		st = append(append([]byte{}, st[:len(st)-2]...), '>')
	}
	r.start = st
	type rep struct {
		c *odsCell
		n int
	}
	var list []rep
	for {
		cs := d.InputOffset()
		tok, err := d.Token()
		if err != nil {
			return nil, fmt.Errorf("content.xml: %w", err)
		}
		if _, ok := tok.(xml.EndElement); ok {
			break
		}
		ce, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		if ce.Name.Space != nsTable || (ce.Name.Local != "table-cell" && ce.Name.Local != "covered-table-cell") {
			if err := d.Skip(); err != nil {
				return nil, err
			}
			continue
		}
		c, n, err := parseCell(d, content, ce, cs)
		if err != nil {
			return nil, err
		}
		list = append(list, rep{c, n})
	}
	r.raw = content[s:d.InputOffset()]
	cols := 0
	for i, x := range list {
		if i == len(list)-1 && x.n > 1 && x.c.empty {
			r.tail, r.tailN = x.c.rawRepeat, x.n
			break
		}
		if cols += x.n; cols > maxODSCols {
			return nil, errors.New("a row has too many columns")
		}
		if *cells += x.n; *cells > maxODSCells {
			return nil, errors.New("the spreadsheet is too large to open")
		}
		for j := 0; j < x.n; j++ {
			c := x.c
			if j > 0 {
				cc := *x.c
				c = &cc
			}
			r.cells = append(r.cells, c)
		}
	}
	return r, nil
}

func parseCell(d *xml.Decoder, content []byte, se xml.StartElement, s int64) (*odsCell, int, error) {
	c := &odsCell{
		covered:  se.Name.Local == "covered-table-cell",
		style:    attr(se, nsTable, "style-name"),
		colSpan:  attr(se, nsTable, "number-columns-spanned"),
		rowSpan:  attr(se, nsTable, "number-rows-spanned"),
		vtype:    attr(se, nsOffice, "value-type"),
		currency: attr(se, nsOffice, "currency"),
		formula:  attr(se, nsTable, "formula"),
	}
	switch c.vtype {
	case "date":
		c.value = attr(se, nsOffice, "date-value")
	case "time":
		c.value = attr(se, nsOffice, "time-value")
	case "boolean":
		c.value = attr(se, nsOffice, "boolean-value")
	case "string":
		c.value = attr(se, nsOffice, "string-value")
	default:
		c.value = attr(se, nsOffice, "value")
	}
	n := 1
	if v, err := strconv.Atoi(attr(se, nsTable, "number-columns-repeated")); err == nil && v > 1 {
		n = v
	}
	startEnd := d.InputOffset()
	var paras []string
	var extra bytes.Buffer
	for {
		cs := d.InputOffset()
		tok, err := d.Token()
		if err != nil {
			return nil, 0, fmt.Errorf("content.xml: %w", err)
		}
		if _, ok := tok.(xml.EndElement); ok {
			break
		}
		ce, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		if ce.Name.Space == nsText && (ce.Name.Local == "p" || ce.Name.Local == "h") {
			p, err := paraText(d)
			if err != nil {
				return nil, 0, err
			}
			paras = append(paras, p)
			continue
		}
		if err := d.Skip(); err != nil {
			return nil, 0, err
		}
		extra.Write(content[cs:d.InputOffset()])
	}
	end := d.InputOffset()
	c.text = strings.Join(paras, "\n")
	c.extra = extra.Bytes()
	c.rawRepeat = content[s:end]
	c.raw = append(reColsRepeat.ReplaceAll(append([]byte{}, content[s:startEnd]...), nil), content[startEnd:end]...)
	c.empty = c.vtype == "" && c.formula == "" && c.text == "" && len(c.extra) == 0
	return c, n, nil
}

// paraText reads the text of a paragraph (the start tag already consumed),
// following ODF's white-space rules.
func paraText(d *xml.Decoder) (string, error) {
	var b strings.Builder
	for depth := 1; depth > 0; {
		tok, err := d.Token()
		if err != nil {
			return "", err
		}
		switch tk := tok.(type) {
		case xml.CharData:
			b.WriteString(reSpace.ReplaceAllString(string(tk), " "))
		case xml.StartElement:
			if tk.Name.Space == nsText {
				switch tk.Name.Local {
				case "s":
					n, err := strconv.Atoi(attr(tk, nsText, "c"))
					if err != nil || n < 1 {
						n = 1
					}
					b.WriteString(strings.Repeat(" ", min(n, 1000)))
					d.Skip()
					continue
				case "tab":
					b.WriteByte('\t')
					d.Skip()
					continue
				case "line-break":
					b.WriteByte('\n')
					d.Skip()
					continue
				case "note", "ruby-text":
					d.Skip()
					continue
				}
			}
			if tk.Name.Space == nsOffice && tk.Name.Local == "annotation" {
				d.Skip()
				continue
			}
			depth++
		case xml.EndElement:
			depth--
		}
	}
	return b.String(), nil
}

// ---- loading ----

// excelEpoch is day 0 of spreadsheet date serials (the 1900 date system).
var excelEpoch = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)

func odfDateSerial(v string) (float64, bool) {
	for _, layout := range []string{"2006-01-02T15:04:05.999999999", "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, v); err == nil {
			return t.Sub(excelEpoch).Hours() / 24, true
		}
	}
	return 0, false
}

var reDuration = regexp.MustCompile(`^-?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$`)

func odfDurationDays(v string) (float64, bool) {
	m := reDuration.FindStringSubmatch(v)
	if m == nil {
		return 0, false
	}
	f := func(s string) float64 { x, _ := strconv.ParseFloat(s, 64); return x }
	days := f(m[1]) + f(m[2])/24 + f(m[3])/1440 + f(m[4])/86400
	if strings.HasPrefix(v, "-") {
		days = -days
	}
	return days, true
}

func serialToODFDate(v float64) string {
	t := excelEpoch.Add(time.Duration(math.Round(v*86400)) * time.Second)
	if t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0 {
		return t.Format("2006-01-02")
	}
	return t.Format("2006-01-02T15:04:05")
}

func daysToODFDuration(v float64) string {
	sign := ""
	if v < 0 {
		sign, v = "-", -v
	}
	secs := int64(math.Round(v * 86400))
	return fmt.Sprintf("%sPT%02dH%02dM%02dS", sign, secs/3600, secs/60%60, secs%60)
}

// loadODS reads an .ods into a new excelize workbook and the display cache.
func (b *book) loadODS(path string) error {
	zr, files, err := openODF(path, mimeODS)
	if err != nil {
		return err
	}
	content, err := readZipFile(files["content.xml"], 512<<20)
	zr.Close()
	if err != nil {
		return err
	}
	doc, err := parseODS(content)
	if err != nil {
		return err
	}
	doc.src = path
	f := excelize.NewFile()
	dateStyle, _ := f.NewStyle(&excelize.Style{NumFmt: 14})
	dateTimeStyle, _ := f.NewStyle(&excelize.Style{NumFmt: 22})
	timeStyle, _ := f.NewStyle(&excelize.Style{NumFmt: 21})
	for i, t := range doc.tables {
		if i == 0 {
			if err := f.SetSheetName("Sheet1", t.name); err != nil {
				return fmt.Errorf("sheet %q: %w", t.name, err)
			}
		} else if _, err := f.NewSheet(t.name); err != nil {
			return fmt.Errorf("sheet %q: %w", t.name, err)
		}
		var disp [][]string
		for r, row := range t.rows {
			for c, cell := range row.cells {
				if cell.empty || cell.covered && cell.vtype == "" && cell.text == "" {
					continue
				}
				ref, _ := excelize.CoordinatesToCellName(c+1, r+1)
				switch cell.vtype {
				case "float", "percentage", "currency":
					v, _ := strconv.ParseFloat(cell.value, 64)
					f.SetCellFloat(t.name, ref, v, -1, 64)
				case "date":
					if v, ok := odfDateSerial(cell.value); ok {
						f.SetCellFloat(t.name, ref, v, -1, 64)
						if v == math.Trunc(v) {
							f.SetCellStyle(t.name, ref, ref, dateStyle)
						} else {
							f.SetCellStyle(t.name, ref, ref, dateTimeStyle)
						}
					} else {
						f.SetCellStr(t.name, ref, cell.text)
					}
				case "time":
					if v, ok := odfDurationDays(cell.value); ok {
						f.SetCellFloat(t.name, ref, v, -1, 64)
						f.SetCellStyle(t.name, ref, ref, timeStyle)
					} else {
						f.SetCellStr(t.name, ref, cell.text)
					}
				case "boolean":
					f.SetCellBool(t.name, ref, cell.value == "true")
				default:
					if cell.text != "" {
						f.SetCellStr(t.name, ref, cell.text)
					}
				}
				if fm, ok := toExcelFormula(cell.formula); ok && fm != "" {
					f.SetCellFormula(t.name, ref, fm)
				}
				for len(disp) <= r {
					disp = append(disp, nil)
				}
				for len(disp[r]) <= c {
					disp[r] = append(disp[r], "")
				}
				disp[r][c] = cell.text
			}
		}
		b.rows[t.name] = disp
	}
	b.f = f
	b.ods = doc
	for _, t := range doc.tables {
		for r, row := range t.rows {
			for c, cell := range row.cells {
				if !cell.empty {
					cell.input = b.inputOf(t.name, r, c)
				}
			}
		}
	}
	return nil
}

// ---- row and sheet edits ----

func (d *odsDoc) insertRow(sheet string, row int) {
	t := d.table(sheet)
	if t == nil || row > len(t.rows) {
		return
	}
	nr := &odsRow{run: t.tailRun}
	nb := row
	if nb >= len(t.rows) {
		nb = len(t.rows) - 1
	}
	if nb >= 0 {
		nr.start, nr.run = t.rows[nb].start, t.rows[nb].run
	}
	t.rows = append(t.rows[:row], append([]*odsRow{nr}, t.rows[row:]...)...)
}

func (d *odsDoc) deleteRow(sheet string, row int) {
	if t := d.table(sheet); t != nil && row < len(t.rows) {
		t.rows = append(t.rows[:row], t.rows[row+1:]...)
	}
}

func (d *odsDoc) addSheet(name string) {
	p := d.pfx[nsTable]
	t := &odsTable{
		name:   name,
		start:  []byte(fmt.Sprintf(`<%s:table %s:name="%s">`, p, p, xmlEscape(name))),
		chunks: [][]byte{[]byte(fmt.Sprintf(`<%s:table-column/>`, p)), []byte(fmt.Sprintf(`</%s:table>`, p))},
	}
	d.tables = append(d.tables, t)
}

// ---- saving ----

func xmlEscape(s string) string {
	var b strings.Builder
	xml.EscapeText(&b, []byte(s))
	return strings.NewReplacer("&#39;", "'", `"`, "&#34;").Replace(b.String())
}

// odsContent builds content.xml from the workbook as it is now.
func (b *book) odsContent() []byte {
	d := b.ods
	var buf bytes.Buffer
	buf.Write(d.head)
	for i, t := range d.tables {
		if i > 0 && i-1 < len(d.between) {
			buf.Write(d.between[i-1])
		}
		b.writeTable(&buf, t)
	}
	buf.Write(d.foot)
	return buf.Bytes()
}

func (b *book) writeTable(buf *bytes.Buffer, t *odsTable) {
	p := b.ods.pfx[nsTable]
	buf.Write(reTableName.ReplaceAll(t.start, []byte("${1}"+strings.ReplaceAll(xmlEscape(t.name), "$", "$$")+"${2}")))
	disp := b.rows[t.name]
	for len(t.rows) < len(disp) {
		run := t.tailRun
		if n := len(t.rows); n > 0 {
			run = t.rows[n-1].run
		}
		t.rows = append(t.rows, &odsRow{run: run})
	}
	for k, chunk := range t.chunks {
		buf.Write(chunk)
		if k == len(t.chunks)-1 {
			break
		}
		for r, row := range t.rows {
			if row.run == k {
				var dr []string
				if r < len(disp) {
					dr = disp[r]
				}
				b.writeRow(buf, t.name, r, row, dr)
			}
		}
		if t.tail != nil && t.tailRun == k {
			n := max(1, t.origTotal-len(t.rows))
			buf.Write(setRepeat(t.tail, "number-rows-repeated", n))
		}
	}
	if len(t.chunks) == 0 {
		fmt.Fprintf(buf, "</%s:table>", p)
	}
}

func setRepeat(raw []byte, attrName string, n int) []byte {
	re := regexp.MustCompile(`(:` + attrName + `=")\d+(")`)
	return re.ReplaceAll(raw, []byte(fmt.Sprintf("${1}%d${2}", n)))
}

func (b *book) writeRow(buf *bytes.Buffer, sheet string, r int, row *odsRow, disp []string) {
	p := b.ods.pfx[nsTable]
	if row.start != nil {
		buf.Write(row.start)
	} else {
		fmt.Fprintf(buf, "<%s:table-row>", p)
	}
	ncols := max(len(row.cells), len(disp))
	tailStyle := ""
	if row.tail != nil {
		if m := regexp.MustCompile(`:style-name="([^"]*)"`).FindSubmatch(row.tail); m != nil {
			tailStyle = string(m[1])
		}
	}
	used := 0
	for c := 0; c < ncols; c++ {
		var cell *odsCell
		if c < len(row.cells) {
			cell = row.cells[c]
		}
		input := b.inputOf(sheet, r, c)
		if cell == nil {
			cell = &odsCell{style: tailStyle}
			if row.tail != nil {
				used++
			}
		}
		b.writeCell(buf, sheet, r, c, cell, input)
	}
	if ncols == 0 && row.tail == nil {
		fmt.Fprintf(buf, "<%s:table-cell/>", p)
	}
	if row.tail != nil {
		if n := row.tailN - used; n > 0 {
			buf.Write(setRepeat(row.tail, "number-columns-repeated", n))
		}
	}
	fmt.Fprintf(buf, "</%s:table-row>", p)
}

func (b *book) writeCell(buf *bytes.Buffer, sheet string, r, c int, cell *odsCell, input string) {
	ref, _ := excelize.CoordinatesToCellName(c+1, r+1)
	formula, _ := b.f.GetCellFormula(sheet, ref)
	var result string
	calculated := false
	if formula != "" {
		v, err := b.f.CalcCellValue(sheet, ref, excelize.Options{RawCellValue: true})
		result, calculated = v, err == nil
	}
	if cell.raw != nil && input == cell.input && (formula == "" || !b.needsCalc || !calculated) {
		buf.Write(cell.raw)
		return
	}
	tp, op, xp := b.ods.pfx[nsTable], b.ods.pfx[nsOffice], b.ods.pfx[nsText]
	name := "table-cell"
	if cell.covered {
		name = "covered-table-cell"
	}
	fmt.Fprintf(buf, "<%s:%s", tp, name)
	if cell.style != "" {
		fmt.Fprintf(buf, ` %s:style-name="%s"`, tp, xmlEscape(cell.style))
	}
	if cell.colSpan != "" {
		fmt.Fprintf(buf, ` %s:number-columns-spanned="%s"`, tp, xmlEscape(cell.colSpan))
	}
	if cell.rowSpan != "" {
		fmt.Fprintf(buf, ` %s:number-rows-spanned="%s"`, tp, xmlEscape(cell.rowSpan))
	}
	text := ""
	value := input
	if formula != "" {
		fmt.Fprintf(buf, ` %s:formula="of:=%s"`, tp, xmlEscape(toOpenFormula(formula)))
		value = result
		if !calculated {
			value = cell.value
		}
	}
	isBool := false
	if formula == "" {
		if ct, _ := b.f.GetCellType(sheet, ref); ct == excelize.CellTypeBool {
			isBool = true
			value = map[bool]string{true: "true", false: "false"}[value == "1" || strings.EqualFold(value, "true")]
		}
	}
	switch {
	case value == "" && formula == "":
	case !isBool && numberInput.MatchString(strings.TrimSpace(value)):
		v, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
		num := strconv.FormatFloat(v, 'f', -1, 64)
		text = num
		switch cell.vtype {
		case "percentage":
			fmt.Fprintf(buf, ` %s:value-type="percentage" %s:value="%s"`, op, op, num)
			text = strconv.FormatFloat(v*100, 'f', -1, 64) + "%"
		case "currency":
			fmt.Fprintf(buf, ` %s:value-type="currency" %s:value="%s"`, op, op, num)
			if cell.currency != "" {
				fmt.Fprintf(buf, ` %s:currency="%s"`, op, xmlEscape(cell.currency))
			}
		case "date":
			text = serialToODFDate(v)
			fmt.Fprintf(buf, ` %s:value-type="date" %s:date-value="%s"`, op, op, text)
		case "time":
			text = daysToODFDuration(v)
			fmt.Fprintf(buf, ` %s:value-type="time" %s:time-value="%s"`, op, op, text)
		default:
			fmt.Fprintf(buf, ` %s:value-type="float" %s:value="%s"`, op, op, num)
		}
	case strings.EqualFold(value, "true") || strings.EqualFold(value, "false"):
		bv := strings.ToLower(value)
		fmt.Fprintf(buf, ` %s:value-type="boolean" %s:boolean-value="%s"`, op, op, bv)
		text = strings.ToUpper(bv)
	default:
		if formula != "" {
			fmt.Fprintf(buf, ` %s:value-type="string" %s:string-value="%s"`, op, op, xmlEscape(value))
		} else {
			fmt.Fprintf(buf, ` %s:value-type="string"`, op)
		}
		text = value
	}
	if text == "" && len(cell.extra) == 0 {
		buf.WriteString("/>")
		return
	}
	buf.WriteString(">")
	buf.Write(cell.extra)
	if text != "" {
		for _, line := range strings.Split(text, "\n") {
			fmt.Fprintf(buf, "<%s:p>%s</%s:p>", xp, odfText(line, xp), xp)
		}
	}
	fmt.Fprintf(buf, "</%s:%s>", tp, name)
}

// odfText encodes text for a paragraph: runs of spaces and tabs need
// elements because XML white space collapses.
func odfText(s, xp string) string {
	var b strings.Builder
	spaces := 0
	flush := func(atStart bool) {
		if spaces == 0 {
			return
		}
		if !atStart {
			b.WriteByte(' ')
			spaces--
		}
		if spaces == 1 {
			fmt.Fprintf(&b, "<%s:s/>", xp)
		} else if spaces > 1 {
			fmt.Fprintf(&b, `<%s:s %s:c="%d"/>`, xp, xp, spaces)
		}
		spaces = 0
	}
	start := true
	for _, r := range s {
		switch r {
		case ' ':
			spaces++
			continue
		case '\t':
			flush(start)
			fmt.Fprintf(&b, "<%s:tab/>", xp)
		default:
			flush(start)
			xml.EscapeText(&b, []byte(string(r)))
		}
		start = false
	}
	flush(start)
	return b.String()
}

// ---- formulas: OpenFormula <-> Excel syntax ----

// toExcelFormula converts "of:=SUM([.A1:.B2];[$Sheet2.C3])" to
// "SUM(A1:B2,Sheet2!C3)". ok is false for an unknown formula language.
func toExcelFormula(f string) (string, bool) {
	if f == "" {
		return "", true
	}
	ns, body, found := strings.Cut(f, ":=")
	if !found {
		ns, body = "", strings.TrimPrefix(f, "=")
	}
	switch ns {
	case "msoxl":
		return body, true
	case "of", "oooc", "":
	default:
		return "", false
	}
	var out strings.Builder
	for i := 0; i < len(body); i++ {
		ch := body[i]
		switch ch {
		case '"':
			j := i + 1
			for j < len(body) {
				if body[j] == '"' {
					if j+1 < len(body) && body[j+1] == '"' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			out.WriteString(body[i:min(j+1, len(body))])
			i = j
		case '[':
			j := i + 1
			inQ := false
			for j < len(body) && (inQ || body[j] != ']') {
				if body[j] == '\'' {
					inQ = !inQ
				}
				j++
			}
			out.WriteString(excelRef(body[i+1 : min(j, len(body))]))
			i = j
		case ';':
			out.WriteByte(',')
		default:
			out.WriteByte(ch)
		}
	}
	return out.String(), true
}

var reBareSheet = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// excelRef converts the inside of an ODF reference ("$Sheet2.A1:.B2").
func excelRef(ref string) string {
	parts := splitOutsideQuotes(ref, ':')
	var out []string
	for i, part := range parts {
		sheet, cell := "", part
		if k := lastDotOutsideQuotes(part); k >= 0 {
			sheet, cell = strings.TrimPrefix(part[:k], "$"), part[k+1:]
		}
		if sheet != "" && i == 0 {
			if !strings.HasPrefix(sheet, "'") && !reBareSheet.MatchString(sheet) {
				sheet = "'" + strings.ReplaceAll(sheet, "'", "''") + "'"
			}
			cell = sheet + "!" + cell
		}
		out = append(out, cell)
	}
	return strings.Join(out, ":")
}

func splitOutsideQuotes(s string, sep byte) []string {
	var out []string
	inQ, from := false, 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\'' {
			inQ = !inQ
		} else if s[i] == sep && !inQ {
			out = append(out, s[from:i])
			from = i + 1
		}
	}
	return append(out, s[from:])
}

func lastDotOutsideQuotes(s string) int {
	inQ, at := false, -1
	for i := 0; i < len(s); i++ {
		if s[i] == '\'' {
			inQ = !inQ
		} else if s[i] == '.' && !inQ {
			at = i
		}
	}
	return at
}

var reExcelRef = regexp.MustCompile(`^(?:('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?`)

// toOpenFormula converts an Excel-syntax formula back to OpenFormula.
func toOpenFormula(f string) string {
	var out strings.Builder
	isWord := func(c byte) bool {
		return c == '_' || c == '.' || c == '$' || c == '\'' || c == '!' || c >= '0' && c <= '9' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z'
	}
	for i := 0; i < len(f); i++ {
		ch := f[i]
		if ch == '"' {
			j := i + 1
			for j < len(f) {
				if f[j] == '"' {
					if j+1 < len(f) && f[j+1] == '"' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			out.WriteString(f[i:min(j+1, len(f))])
			i = j
			continue
		}
		if ch == ',' {
			out.WriteByte(';')
			continue
		}
		if i == 0 || !isWord(f[i-1]) {
			if m := reExcelRef.FindStringSubmatchIndex(f[i:]); m != nil {
				end := i + m[1]
				next := byte(0)
				if end < len(f) {
					next = f[end]
				}
				if next != '(' && !(next == '_' || next >= '0' && next <= '9' || next >= 'A' && next <= 'Z' || next >= 'a' && next <= 'z') {
					sheet := ""
					if m[2] >= 0 {
						sheet = f[i+m[2] : i+m[3]]
					}
					first := f[i+m[4] : i+m[5]]
					out.WriteByte('[')
					if sheet != "" {
						out.WriteString("$" + sheet + "." + first)
					} else {
						out.WriteString("." + first)
					}
					if m[6] >= 0 {
						out.WriteString(":." + f[i+m[6]:i+m[7]])
					}
					out.WriteByte(']')
					i = end - 1
					continue
				}
			}
		}
		out.WriteByte(ch)
	}
	return out.String()
}
