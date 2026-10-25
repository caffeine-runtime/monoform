package convert

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"image"
	"image/png"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-pdf/fpdf"

	"github.com/caffeine-runtime/monoform/internal/fs"
	"github.com/caffeine-runtime/monoform/internal/imaging"
)

// The PDF's fonts, the app's own: Inter for text, Source Serif 4 for
// headings (as in the Markdown preview), JetBrains Mono for code. All three
// are SIL Open Font License; fonts/README.md says how they were cut down to
// Latin, Greek and Cyrillic.
//
//go:embed fonts/*.ttf
var fontFiles embed.FS

// Page geometry, in millimetres.
const (
	marginX   = 22.0
	marginTop = 20.0
	marginBot = 22.0
	bodyPt    = 10.5
	codePt    = 9.0
	ptMM      = 0.3528 // one point in mm
)

// Font families as named in the PDF.
const (
	sans  = "Inter"
	serif = "SourceSerif4"
	mono  = "JetBrainsMono"
)

type rgb struct{ r, g, b int }

var (
	ink    = rgb{29, 29, 31}
	muted  = rgb{110, 110, 115}
	rule   = rgb{217, 217, 222}
	soft   = rgb{244, 244, 246}
	linkCl = rgb{11, 98, 214}
)

type pdfWriter struct {
	f    *fpdf.Fpdf
	d    *Doc
	pw   float64 // page width
	ph   float64
	tw   float64 // text width
	pics int
	// The last heading's outline level (-1: none yet).
	outline int
}

func (w *pdfWriter) color(c rgb)              { w.f.SetTextColor(c.r, c.g, c.b) }
func (w *pdfWriter) lineH(pt float64) float64 { return pt * ptMM * 1.55 }

// writePDF lays the document out on A4 pages (landscape for wide tables)
// with page numbers and an outline of the headings. It returns some of the
// characters the fonts have no glyphs for ("" when all are covered).
func writePDF(ctx context.Context, dst string, d *Doc) (string, error) {
	orient := "P"
	if d.Landscape {
		orient = "L"
	}
	f := fpdf.New(orient, "mm", "A4", "")
	for _, ft := range []struct{ family, style, file string }{
		{sans, "", "Inter-Regular.ttf"}, {sans, "B", "Inter-Bold.ttf"}, {sans, "I", "Inter-Italic.ttf"}, {sans, "BI", "Inter-BoldItalic.ttf"},
		{serif, "", "SourceSerif4-Semibold.ttf"}, {mono, "", "JetBrainsMono-Regular.ttf"},
	} {
		b, err := fontFiles.ReadFile("fonts/" + ft.file)
		if err != nil {
			return "", err
		}
		f.AddUTF8FontFromBytes(ft.family, ft.style, b)
	}
	f.SetTitle(d.Title, true)
	f.SetCreator("Monoform", true)
	f.SetProducer("Monoform", true)
	f.SetCreationDate(time.Now())
	f.SetMargins(marginX, marginTop, marginX)
	f.SetAutoPageBreak(true, marginBot)
	f.SetCellMargin(0)
	f.AliasNbPages("{nb}")
	w := &pdfWriter{f: f, d: d, outline: -1}
	w.pw, w.ph = f.GetPageSize()
	w.tw = w.pw - 2*marginX
	f.SetFooterFunc(func() {
		f.SetY(-marginBot + 8)
		f.SetFont(sans, "", 8.5)
		w.color(muted)
		f.CellFormat(0, 5, fmt.Sprintf("%d / {nb}", f.PageNo()), "", 0, "C", false, 0, "")
	})
	f.AddPage()
	var prev *Block
	for i, blk := range d.Blocks {
		if i%64 == 0 {
			if err := ctx.Err(); err != nil {
				return "", err
			}
		}
		w.block(blk, prev)
		prev = &d.Blocks[i]
		if f.Err() {
			return "", f.Error()
		}
	}
	return uncovered(d), fs.AtomicWrite(dst, func(out io.Writer) error { return f.Output(out) })
}

func (w *pdfWriter) bottom() float64 { return w.ph - marginBot }

// ensure starts a new page unless h millimetres fit on this one.
func (w *pdfWriter) ensure(h float64) {
	if w.f.GetY()+h > w.bottom() && w.f.GetY() > marginTop+1 {
		w.f.AddPage()
	}
}

// space adds vertical space, not at the top of a page.
func (w *pdfWriter) space(h float64) {
	if w.f.GetY() > marginTop+0.5 {
		w.f.SetY(min(w.f.GetY()+h, w.bottom()))
	}
}

var headingPt = [7]float64{0, 21, 16, 13.5, 11.5, bodyPt, bodyPt}

func (w *pdfWriter) block(blk Block, prev *Block) {
	f := w.f
	bodyLH := w.lineH(bodyPt)
	first := prev == nil
	if prev != nil && prev.Kind == ListItem && (blk.Kind != ListItem || blk.Level == 0 && blk.Ordered != prev.Ordered) {
		w.space(bodyLH * 0.4)
	}
	switch blk.Kind {
	case Heading:
		l := min(max(blk.Level, 1), 6)
		pt := headingPt[l]
		lh := pt * ptMM * 1.3
		if !first {
			w.space(pt * ptMM * 1.1)
		}
		w.ensure(lh + 3*bodyLH) // keep with what follows
		// Outline levels can't skip (an h3 under an h1 is one level down).
		lv := min(l-1, w.outline+1)
		w.outline = lv
		f.Bookmark(runsText(blk.Runs), lv, -1)
		f.SetX(marginX)
		w.runs(blk.Runs, serif, pt, lh, ink, true)
		f.Ln(lh)
		w.space(pt * ptMM * 0.35)
	case Para:
		w.ensure(2 * bodyLH)
		f.SetX(marginX)
		w.runs(blk.Runs, sans, bodyPt, bodyLH, ink, false)
		f.Ln(bodyLH)
		w.space(bodyLH * 0.55)
	case Quote:
		w.ensure(2 * bodyLH)
		indent := 5.0
		page, y0 := f.PageNo(), f.GetY()
		f.SetLeftMargin(marginX + indent)
		f.SetX(marginX + indent)
		w.runs(blk.Runs, sans, bodyPt, bodyLH, muted, false)
		f.Ln(bodyLH)
		f.SetLeftMargin(marginX)
		w.bar(page, y0, f.PageNo(), f.GetY())
		w.space(bodyLH * 0.55)
	case ListItem:
		w.ensure(bodyLH)
		indent := 6.5 + float64(blk.Level)*6
		runs := blk.Runs
		// Tasks get a drawn box (Inter has no ☐/☑).
		task, done := false, false
		if len(runs) > 0 && (strings.HasPrefix(runs[0].Text, "☐ ") || strings.HasPrefix(runs[0].Text, "☑ ")) {
			task, done = true, strings.HasPrefix(runs[0].Text, "☑")
			runs = append([]Inline{runs[0]}, runs[1:]...)
			_, size := utf8.DecodeRuneInString(runs[0].Text)
			runs[0].Text = runs[0].Text[size+1:]
		}
		f.SetFont(sans, "", bodyPt)
		w.color(muted)
		y := f.GetY()
		switch {
		case task:
			s := 3.0
			bx, by := marginX+indent-s-1.8, y+(bodyLH-s)/2
			f.SetDrawColor(muted.r, muted.g, muted.b)
			f.SetLineWidth(0.25)
			f.Rect(bx, by, s, s, "D")
			if done {
				f.SetLineWidth(0.4)
				f.Line(bx+0.6, by+1.6, bx+1.3, by+2.4)
				f.Line(bx+1.3, by+2.4, bx+2.5, by+0.6)
			}
		default:
			marker := []string{"•", "◦", "▪"}[blk.Level%3]
			if blk.Ordered {
				marker = fmt.Sprintf("%d.", max(blk.Number, 1))
			}
			mw := f.GetStringWidth(marker)
			f.SetXY(marginX+indent-mw-1.8, y)
			f.CellFormat(mw, bodyLH, marker, "", 0, "L", false, 0, "")
		}
		f.SetLeftMargin(marginX + indent)
		f.SetXY(marginX+indent, y)
		w.runs(runs, sans, bodyPt, bodyLH, ink, false)
		f.Ln(bodyLH)
		f.SetLeftMargin(marginX)
		w.space(bodyLH * 0.18)
	case Code:
		w.code(blk.Text)
	case Rule:
		w.space(bodyLH * 0.4)
		f.SetDrawColor(rule.r, rule.g, rule.b)
		f.SetLineWidth(0.3)
		f.Line(marginX, f.GetY(), marginX+w.tw, f.GetY())
		w.space(bodyLH)
	case Table:
		w.table(blk.Rows)
	case Picture:
		w.picture(blk)
	}
}

// bar draws a quote's left rule from (page0, y0) to (page1, y1).
func (w *pdfWriter) bar(page0 int, y0 float64, page1 int, y1 float64) {
	f := w.f
	f.SetDrawColor(rule.r, rule.g, rule.b)
	f.SetLineWidth(0.8)
	cur := f.PageNo()
	x := marginX + 1
	for p := page0; p <= page1; p++ {
		top, bot := marginTop, w.bottom()
		if p == page0 {
			top = y0 + 0.6
		}
		if p == page1 {
			bot = y1 - 0.6
		}
		if bot > top {
			f.SetPage(p)
			f.Line(x, top, x, bot)
		}
	}
	f.SetPage(cur)
}

// runs writes styled text that wraps at the margins.
func (w *pdfWriter) runs(runs []Inline, family string, pt, lh float64, c rgb, heading bool) {
	f := w.f
	for _, r := range runs {
		if r.Text == "\n" {
			f.Ln(lh)
			continue
		}
		fam, size, style := family, pt, ""
		if r.Bold && !heading {
			style += "B"
		}
		if r.Italic {
			style += "I"
		}
		if heading && family == serif {
			style = "" // one face of the serif; headings are already bold
		}
		if r.Code {
			fam, size, style = mono, pt*0.9, ""
		}
		f.SetFont(fam, style, size)
		text := strings.ReplaceAll(r.Text, "\t", "    ")
		if r.Link != "" && externalLink(r.Link) {
			w.color(linkCl)
			for _, part := range chunks(text) {
				f.WriteLinkString(lh, part, r.Link)
			}
		} else {
			w.color(c)
			if r.Code {
				w.color(rgb{70, 70, 76})
			}
			if r.Strike {
				w.struck(text, lh, size)
				continue
			}
			for _, part := range chunks(text) {
				f.Write(lh, part)
			}
		}
	}
}

// struck writes text word by word with a line through each word where it
// lands (fpdf's own strikeout sits too high with these fonts).
func (w *pdfWriter) struck(text string, lh, pt float64) {
	f := w.f
	f.SetDrawColor(ink.r, ink.g, ink.b)
	f.SetLineWidth(pt * ptMM * 0.07)
	for _, word := range strings.SplitAfter(text, " ") {
		if word == "" {
			continue
		}
		f.Write(lh, word)
		x1, y := f.GetX(), f.GetY()
		ww := f.GetStringWidth(strings.TrimRight(word, " "))
		x1 -= f.GetStringWidth(word) - ww
		sy := y + lh/2 + 0.3*pt*ptMM - 0.28*pt*ptMM
		f.Line(x1-ww, sy, x1, sy)
	}
}

// chunks splits long text at spaces: fpdf's Write is quadratic in the
// length of what it is given.
func chunks(s string) []string {
	const n = 300
	if len(s) <= n {
		return []string{s}
	}
	var out []string
	for len(s) > n {
		i := strings.LastIndexByte(s[:n], ' ')
		if i <= 0 {
			i = n
			for i < len(s) && s[i]&0xC0 == 0x80 { // not inside a UTF-8 sequence
				i++
			}
		} else {
			i++
		}
		out = append(out, s[:i])
		s = s[i:]
	}
	return append(out, s)
}

func (w *pdfWriter) code(text string) {
	f := w.f
	pad := 3.0
	lh := codePt * ptMM * 1.45
	f.SetFont(mono, "", codePt)
	var lines []string
	for _, l := range strings.Split(strings.ReplaceAll(text, "\t", "    "), "\n") {
		if l == "" {
			lines = append(lines, "")
			continue
		}
		lines = append(lines, f.SplitText(l, w.tw-2*pad)...)
	}
	w.ensure(min(float64(len(lines)), 3)*lh + 2*pad)
	f.SetFillColor(soft.r, soft.g, soft.b)
	w.color(rgb{50, 50, 56})
	f.SetCellMargin(pad)
	f.CellFormat(w.tw, pad*0.6, "", "", 2, "L", true, 0, "")
	for _, l := range lines {
		if f.GetY()+lh > w.bottom() {
			f.AddPage()
			f.SetFont(mono, "", codePt)
			w.color(rgb{50, 50, 56})
		}
		f.CellFormat(w.tw, lh, l, "", 2, "L", true, 0, "")
	}
	f.CellFormat(w.tw, pad*0.6, "", "", 2, "L", true, 0, "")
	f.SetCellMargin(0)
	w.space(w.lineH(bodyPt) * 0.55)
}

// table lays out a table across the text width, columns sized by their
// content, the header row repeated on each page.
func (w *pdfWriter) table(rows [][][]Inline) {
	f := w.f
	cols := 0
	for _, r := range rows {
		cols = max(cols, len(r))
	}
	if cols == 0 {
		return
	}
	pt := 9.0
	if cols > 8 {
		pt = 7.5
	}
	pad := 1.8
	lh := pt * ptMM * 1.4
	text := func(r [][]Inline, c int) string {
		if c < len(r) {
			return strings.ReplaceAll(runsText(r[c]), "\t", " ")
		}
		return ""
	}
	// Natural widths, from the first rows.
	f.SetFont(sans, "B", pt)
	natural := make([]float64, cols)
	for i, r := range rows[:min(len(rows), 300)] {
		if i == 1 {
			f.SetFont(sans, "", pt)
		}
		for c := range cols {
			wd := 0.0
			for _, l := range strings.Split(text(r, c), "\n") {
				wd = max(wd, f.GetStringWidth(l))
			}
			natural[c] = max(natural[c], min(wd+2*pad+0.5, w.tw*0.5))
		}
	}
	widths := make([]float64, cols)
	sum := 0.0
	for _, n := range natural {
		sum += max(n, 8)
	}
	for c := range cols {
		widths[c] = max(natural[c], 8) * w.tw / sum
	}
	header := len(rows) > 1
	drawRow := func(r [][]Inline, bold bool) {
		style := ""
		if bold {
			style = "B"
		}
		f.SetFont(sans, style, pt)
		cells := make([][]string, cols)
		n := 1
		for c := range cols {
			for _, l := range strings.Split(text(r, c), "\n") {
				cells[c] = append(cells[c], f.SplitText(l, max(widths[c]-2*pad, 1))...)
			}
			n = max(n, len(cells[c]))
		}
		h := float64(n)*lh + 2*pad
		if f.GetY()+h > w.bottom() {
			f.AddPage()
			if header && !bold {
				w.tableHeader(rows[0], widths, pt, pad, lh, text)
			}
			f.SetFont(sans, style, pt)
		}
		y := f.GetY()
		x := marginX
		f.SetDrawColor(rule.r, rule.g, rule.b)
		f.SetLineWidth(0.2)
		f.SetFillColor(soft.r, soft.g, soft.b)
		for c := range cols {
			fill := "D"
			if bold {
				fill = "FD"
			}
			f.Rect(x, y, widths[c], min(h, w.bottom()-y), fill)
			w.color(ink)
			for i, l := range cells[c] {
				ly := y + pad + float64(i)*lh
				if ly+lh > w.bottom() {
					break
				}
				f.SetXY(x+pad, ly)
				f.CellFormat(widths[c]-2*pad, lh, l, "", 0, "L", false, 0, "")
			}
			x += widths[c]
		}
		f.SetXY(marginX, y+min(h, w.bottom()-y))
	}
	w.ensure(2*(lh+2*pad) + 1)
	for i, r := range rows {
		drawRow(r, i == 0 && header)
	}
	w.space(w.lineH(bodyPt) * 0.8)
}

func (w *pdfWriter) tableHeader(r [][]Inline, widths []float64, pt, pad, lh float64, text func([][]Inline, int) string) {
	f := w.f
	f.SetFont(sans, "B", pt)
	n := 1
	cells := make([][]string, len(widths))
	for c := range widths {
		for _, l := range strings.Split(text(r, c), "\n") {
			cells[c] = append(cells[c], f.SplitText(l, max(widths[c]-2*pad, 1))...)
		}
		n = max(n, len(cells[c]))
	}
	h := float64(n)*lh + 2*pad
	y, x := f.GetY(), marginX
	f.SetFillColor(soft.r, soft.g, soft.b)
	for c := range widths {
		f.Rect(x, y, widths[c], h, "FD")
		w.color(ink)
		for i, l := range cells[c] {
			f.SetXY(x+pad, y+pad+float64(i)*lh)
			f.CellFormat(widths[c]-2*pad, lh, l, "", 0, "L", false, 0, "")
		}
		x += widths[c]
	}
	f.SetXY(marginX, y+h)
}

// picture places a picture at its size (96 dpi), within the text width and
// two thirds of the page height, centred.
func (w *pdfWriter) picture(blk Block) {
	f := w.f
	p := w.d.picturePath(blk.Text)
	if p == "" {
		if blk.Alt != "" {
			w.block(Block{Kind: Para, Runs: []Inline{{Text: blk.Alt, Italic: true}}}, &blk)
		}
		return
	}
	data, ext, cfg, err := pictureData(p)
	if err != nil || cfg.Width == 0 || cfg.Height == 0 {
		return
	}
	if ext != "jpg" {
		// fpdf reads 8-bit, non-interlaced PNGs: write the picture as one.
		img, _, err := image.Decode(bytes.NewReader(data))
		if err != nil {
			return
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, imaging.ToNRGBA(img)); err != nil {
			return
		}
		data, ext = buf.Bytes(), "png"
	}
	w.pics++
	name := fmt.Sprintf("picture-%d", w.pics)
	typ := map[string]string{"jpg": "JPG", "png": "PNG"}[ext]
	f.RegisterImageOptionsReader(name, fpdf.ImageOptions{ImageType: typ}, bytes.NewReader(data))
	if f.Err() {
		f.ClearError()
		return
	}
	iw, ih := float64(cfg.Width)*25.4/96, float64(cfg.Height)*25.4/96
	maxH := (w.ph - marginTop - marginBot) * 2 / 3
	if iw > w.tw {
		ih, iw = ih*w.tw/iw, w.tw
	}
	if ih > maxH {
		iw, ih = iw*maxH/ih, maxH
	}
	w.ensure(ih)
	w.space(1)
	y := f.GetY()
	f.ImageOptions(name, marginX+(w.tw-iw)/2, y, iw, ih, false, fpdf.ImageOptions{ImageType: typ}, 0, "")
	f.SetY(y + ih)
	w.space(w.lineH(bodyPt) * 0.8)
}

// The characters the embedded fonts have (fonts/README.md).
var covered = [][2]rune{
	{0x20, 0x7E}, {0xA0, 0x24F}, {0x300, 0x36F}, {0x370, 0x3FF}, {0x400, 0x4FF}, {0x1E00, 0x1EFF},
	{0x2000, 0x206F}, {0x20A0, 0x20CF}, {0x2100, 0x214F}, {0x2190, 0x21FF}, {0x2200, 0x22FF},
	{0x2500, 0x257F}, {0x25A0, 0x25FF}, {0x2610, 0x2612}, {0x2713, 0x2714}, {0xFFFD, 0xFFFD},
}

func hasGlyph(r rune) bool {
	if r < 0x20 {
		return true // line breaks and tabs are layout
	}
	for _, c := range covered {
		if r >= c[0] && r <= c[1] {
			return true
		}
	}
	return false
}

// uncovered lists up to five characters of the document without glyphs.
func uncovered(d *Doc) string {
	var out []rune
	seen := map[rune]bool{}
	check := func(s string) bool {
		for _, r := range s {
			if !hasGlyph(r) && !seen[r] {
				seen[r] = true
				out = append(out, r)
				if len(out) == 5 {
					return false
				}
			}
		}
		return true
	}
	runs := func(rs []Inline) bool {
		for _, r := range rs {
			if !check(r.Text) {
				return false
			}
		}
		return true
	}
	for _, b := range d.Blocks {
		ok := runs(b.Runs) && (b.Kind != Code || check(b.Text))
		for _, row := range b.Rows {
			for _, c := range row {
				ok = ok && runs(c)
			}
		}
		if !ok {
			break
		}
	}
	return string(out)
}
