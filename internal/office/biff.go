package office

// A small reader for legacy Excel 97–2003 workbooks (BIFF8 in an OLE compound
// file). It reads cell values (numbers, dates, text, booleans, cached formula
// results) and sheet names — enough to show and edit the data and save it as
// .xlsx. Formulas, formatting and charts are not carried over (said in the UI).

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/richardlehane/mscfb"
	"golang.org/x/text/encoding/charmap"
)

// XlsCell is one value read from a .xls sheet.
type XlsCell struct {
	Row, Col int
	Kind     string // "number", "date", "string", "bool", "error"
	Num      float64
	Str      string
	Bool     bool
	Time     time.Time
}

type XlsSheet struct {
	Name  string
	Cells []XlsCell
}

var ErrNotBIFF8 = errors.New("this .xls file uses an old Excel format (before Excel 97) that isn't supported")

// ReadXls reads every worksheet of a .xls file.
func ReadXls(path string) (sheets []XlsSheet, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("could not read this .xls file: %v", r)
		}
	}()
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	stream, err := oleStream(f, "Workbook", "Book")
	if err != nil {
		return nil, err
	}
	return parseBIFF(stream)
}

// oleStream returns the contents of the first stream with one of the names.
func oleStream(r io.ReaderAt, names ...string) ([]byte, error) {
	doc, err := mscfb.New(r)
	if err != nil {
		return nil, fmt.Errorf("not an Office compound file: %w", err)
	}
	for e, err := doc.Next(); err == nil; e, err = doc.Next() {
		for i, n := range names {
			if e.Name == n {
				if n == "Book" && i > 0 {
					return nil, ErrNotBIFF8
				}
				buf := make([]byte, e.Size)
				if _, err := io.ReadFull(e, buf); err != nil {
					return nil, err
				}
				return buf, nil
			}
		}
	}
	return nil, fmt.Errorf("stream %q not found", names[0])
}

type record struct {
	typ  uint16
	data []byte
	pos  int
}

func records(b []byte, from int) func() (record, bool) {
	p := from
	return func() (record, bool) {
		if p+4 > len(b) {
			return record{}, false
		}
		typ := binary.LittleEndian.Uint16(b[p:])
		n := int(binary.LittleEndian.Uint16(b[p+2:]))
		if p+4+n > len(b) {
			return record{}, false
		}
		r := record{typ: typ, data: b[p+4 : p+4+n], pos: p}
		p += 4 + n
		return r, true
	}
}

const (
	recBOF        = 0x0809
	recEOF        = 0x000A
	recBoundSheet = 0x0085
	recSST        = 0x00FC
	recContinue   = 0x003C
	recFormat     = 0x041E
	recXF         = 0x00E0
	recDateMode   = 0x0022
	recLabelSST   = 0x00FD
	recNumber     = 0x0203
	recRK         = 0x027E
	recMulRK      = 0x00BD
	recLabel      = 0x0204
	recBoolErr    = 0x0205
	recFormula    = 0x0006
	recString     = 0x0207
	recCodepage   = 0x0042
)

type sheetRef struct {
	name string
	pos  int
	kind byte
}

func parseBIFF(b []byte) ([]XlsSheet, error) {
	next := records(b, 0)
	first, ok := next()
	if !ok || first.typ != recBOF || len(first.data) < 2 {
		return nil, errors.New("not a BIFF workbook")
	}
	if v := binary.LittleEndian.Uint16(first.data); v != 0x0600 {
		return nil, ErrNotBIFF8
	}
	var refs []sheetRef
	var sst []string
	formats := map[int]string{}
	var xfFormat []int
	date1904 := false
	// Globals substream, with SST spread across CONTINUE records.
	for {
		r, ok := next()
		if !ok || r.typ == recEOF {
			break
		}
		switch r.typ {
		case recBoundSheet:
			if len(r.data) < 8 {
				continue
			}
			pos := int(binary.LittleEndian.Uint32(r.data))
			name, _ := shortString(r.data[6:])
			refs = append(refs, sheetRef{name: name, pos: pos, kind: r.data[5]})
		case recSST:
			parts := [][]byte{r.data}
			for {
				nr, ok := next()
				if !ok {
					break
				}
				if nr.typ != recContinue {
					// Not ours: rewind by re-creating the iterator at this record.
					next = records(b, nr.pos)
					break
				}
				parts = append(parts, nr.data)
			}
			sst = readSST(parts)
		case recFormat:
			if len(r.data) >= 4 {
				id := int(binary.LittleEndian.Uint16(r.data))
				s, _ := unicodeString(r.data[2:])
				formats[id] = s
			}
		case recXF:
			if len(r.data) >= 4 {
				xfFormat = append(xfFormat, int(binary.LittleEndian.Uint16(r.data[2:])))
			}
		case recDateMode:
			date1904 = len(r.data) >= 2 && binary.LittleEndian.Uint16(r.data) == 1
		}
	}
	isDate := func(ixfe int) bool {
		if ixfe < 0 || ixfe >= len(xfFormat) {
			return false
		}
		id := xfFormat[ixfe]
		if (id >= 14 && id <= 22) || (id >= 45 && id <= 47) {
			return true
		}
		return dateFormat(formats[id])
	}
	var out []XlsSheet
	for _, ref := range refs {
		if ref.kind != 0 { // charts, macros
			continue
		}
		sh := XlsSheet{Name: ref.name}
		next := records(b, ref.pos)
		bof, ok := next()
		if !ok || bof.typ != recBOF {
			continue
		}
		var pending *XlsCell // formula with a string result in the next STRING record
		for {
			r, ok := next()
			if !ok || r.typ == recEOF {
				break
			}
			d := r.data
			cell := func(i int) (int, int, int) {
				return int(binary.LittleEndian.Uint16(d[i:])), int(binary.LittleEndian.Uint16(d[i+2:])), int(binary.LittleEndian.Uint16(d[i+4:]))
			}
			num := func(row, col, ixfe int, v float64) XlsCell {
				if isDate(ixfe) {
					return XlsCell{Row: row, Col: col, Kind: "date", Num: v, Time: excelTime(v, date1904)}
				}
				return XlsCell{Row: row, Col: col, Kind: "number", Num: v}
			}
			switch r.typ {
			case recLabelSST:
				if len(d) >= 10 {
					row, col, _ := cell(0)
					i := int(binary.LittleEndian.Uint32(d[6:]))
					if i < len(sst) {
						sh.Cells = append(sh.Cells, XlsCell{Row: row, Col: col, Kind: "string", Str: sst[i]})
					}
				}
			case recNumber:
				if len(d) >= 14 {
					row, col, x := cell(0)
					sh.Cells = append(sh.Cells, num(row, col, x, math.Float64frombits(binary.LittleEndian.Uint64(d[6:]))))
				}
			case recRK:
				if len(d) >= 10 {
					row, col, x := cell(0)
					sh.Cells = append(sh.Cells, num(row, col, x, rk(binary.LittleEndian.Uint32(d[6:]))))
				}
			case recMulRK:
				if len(d) >= 6 {
					row := int(binary.LittleEndian.Uint16(d))
					col := int(binary.LittleEndian.Uint16(d[2:]))
					for i := 4; i+6 <= len(d)-2; i += 6 {
						x := int(binary.LittleEndian.Uint16(d[i:]))
						sh.Cells = append(sh.Cells, num(row, col, x, rk(binary.LittleEndian.Uint32(d[i+2:]))))
						col++
					}
				}
			case recLabel:
				if len(d) >= 8 {
					row, col, _ := cell(0)
					s, _ := unicodeString(d[6:])
					sh.Cells = append(sh.Cells, XlsCell{Row: row, Col: col, Kind: "string", Str: s})
				}
			case recBoolErr:
				if len(d) >= 8 {
					row, col, _ := cell(0)
					if d[7] == 0 {
						sh.Cells = append(sh.Cells, XlsCell{Row: row, Col: col, Kind: "bool", Bool: d[6] != 0})
					} else {
						sh.Cells = append(sh.Cells, XlsCell{Row: row, Col: col, Kind: "error", Str: errorText(d[6])})
					}
				}
			case recFormula:
				if len(d) >= 14 {
					row, col, x := cell(0)
					v := d[6:14]
					if v[6] == 0xFF && v[7] == 0xFF {
						switch v[0] {
						case 0:
							sh.Cells = append(sh.Cells, XlsCell{Row: row, Col: col, Kind: "string"})
							pending = &sh.Cells[len(sh.Cells)-1]
						case 1:
							sh.Cells = append(sh.Cells, XlsCell{Row: row, Col: col, Kind: "bool", Bool: v[2] != 0})
						case 2:
							sh.Cells = append(sh.Cells, XlsCell{Row: row, Col: col, Kind: "error", Str: errorText(v[2])})
						}
					} else {
						sh.Cells = append(sh.Cells, num(row, col, x, math.Float64frombits(binary.LittleEndian.Uint64(v))))
					}
				}
			case recString:
				if pending != nil {
					s, _ := unicodeString(d)
					pending.Str = s
					pending = nil
				}
			}
		}
		out = append(out, sh)
	}
	return out, nil
}

func rk(v uint32) float64 {
	var f float64
	if v&0x02 != 0 {
		f = float64(int32(v) >> 2)
	} else {
		f = math.Float64frombits(uint64(v&0xFFFFFFFC) << 32)
	}
	if v&0x01 != 0 {
		f /= 100
	}
	return f
}

func errorText(code byte) string {
	switch code {
	case 0x00:
		return "#NULL!"
	case 0x07:
		return "#DIV/0!"
	case 0x0F:
		return "#VALUE!"
	case 0x17:
		return "#REF!"
	case 0x1D:
		return "#NAME?"
	case 0x24:
		return "#NUM!"
	case 0x2A:
		return "#N/A"
	}
	return "#ERROR"
}

// shortString reads a ShortXLUnicodeString (cch byte, flags byte, chars).
func shortString(b []byte) (string, int) {
	if len(b) < 2 {
		return "", len(b)
	}
	n := int(b[0])
	return chars(b[2:], n, b[1]&1 != 0)
}

// unicodeString reads an XLUnicodeString (cch uint16, flags byte, chars).
func unicodeString(b []byte) (string, int) {
	if len(b) < 3 {
		return "", len(b)
	}
	n := int(binary.LittleEndian.Uint16(b))
	s, used := chars(b[3:], n, b[2]&1 != 0)
	return s, 3 + used
}

func chars(b []byte, n int, wide bool) (string, int) {
	if wide {
		if 2*n > len(b) {
			n = len(b) / 2
		}
		u := make([]uint16, n)
		for i := range u {
			u[i] = binary.LittleEndian.Uint16(b[2*i:])
		}
		return string(utf16.Decode(u)), 2 * n
	}
	if n > len(b) {
		n = len(b)
	}
	s, _ := charmap.Windows1252.NewDecoder().Bytes(b[:n])
	return string(s), n
}

// readSST decodes the shared string table, which may continue across
// CONTINUE records (each continuation of a string starts with a new flags byte).
func readSST(parts [][]byte) []string {
	if len(parts) == 0 || len(parts[0]) < 8 {
		return nil
	}
	unique := int(binary.LittleEndian.Uint32(parts[0][4:]))
	out := make([]string, 0, unique)
	pi, p := 0, 8
	cur := parts[0]
	need := func(n int) bool {
		for p+n > len(cur) {
			if p < len(cur) {
				return false // split inside a fixed-size field: give up
			}
			pi++
			if pi >= len(parts) {
				return false
			}
			cur, p = parts[pi], 0
		}
		return true
	}
	for len(out) < unique {
		if !need(3) {
			break
		}
		cch := int(binary.LittleEndian.Uint16(cur[p:]))
		flags := cur[p+2]
		p += 3
		wide := flags&0x01 != 0
		rich := flags&0x08 != 0
		ext := flags&0x04 != 0
		runs, extLen := 0, 0
		if rich {
			if !need(2) {
				break
			}
			runs = int(binary.LittleEndian.Uint16(cur[p:]))
			p += 2
		}
		if ext {
			if !need(4) {
				break
			}
			extLen = int(binary.LittleEndian.Uint32(cur[p:]))
			p += 4
		}
		var sb strings.Builder
		left := cch
		for left > 0 {
			if p >= len(cur) {
				pi++
				if pi >= len(parts) {
					left = 0
					break
				}
				cur, p = parts[pi], 0
				wide = cur[0]&0x01 != 0
				p = 1
			}
			size := 1
			if wide {
				size = 2
			}
			n := min(left, (len(cur)-p)/size)
			s, used := chars(cur[p:], n, wide)
			sb.WriteString(s)
			p += used
			left -= n
			if n == 0 {
				break
			}
		}
		out = append(out, sb.String())
		skip := runs*4 + extLen
		for skip > 0 {
			if p >= len(cur) {
				pi++
				if pi >= len(parts) {
					break
				}
				cur, p = parts[pi], 0
			}
			n := min(skip, len(cur)-p)
			p += n
			skip -= n
		}
	}
	return out
}

var quoted = regexp.MustCompile(`"[^"]*"|\[[^\]]*\]|\\.`)

// dateFormat reports whether a number format string displays a date/time.
func dateFormat(f string) bool {
	if f == "" {
		return false
	}
	s := strings.ToLower(quoted.ReplaceAllString(f, ""))
	return strings.ContainsAny(s, "dmyhs") && !strings.Contains(s, "general")
}

// excelTime converts an Excel serial date.
func excelTime(v float64, date1904 bool) time.Time {
	base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	if date1904 {
		base = time.Date(1904, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	days := math.Floor(v)
	frac := v - days
	t := base.AddDate(0, 0, int(days))
	return t.Add(time.Duration(math.Round(frac*86400)) * time.Second)
}

// FormatNumber renders a number like a spreadsheet's General format.
func FormatNumber(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e15 {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'g', 15, 64)
}
