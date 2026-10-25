package convert

import (
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"image"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/caffeine-runtime/monoform/internal/imaging"
	"github.com/caffeine-runtime/monoform/internal/office"
)

const (
	nsW   = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	nsR   = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	nsMC  = "http://schemas.openxmlformats.org/markup-compatibility/2006"
	maxIn = 64 << 20 // largest picture taken out of a document
)

func attrOf(se xml.StartElement, local string) string {
	for _, a := range se.Attr {
		if a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

func attrNS(se xml.StartElement, space, local string) string {
	for _, a := range se.Attr {
		if a.Name.Space == space && a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

// on reads a w:b / w:i style toggle: present and not switched off.
func on(se xml.StartElement) bool {
	v := attrNS(se, nsW, "val")
	return v != "0" && v != "false" && v != "off" && v != "none"
}

// numLevel is one level of a list definition.
type numLevel struct {
	numbered bool
	start    int
}

// numbering maps numId → level → whether it is numbered and where it starts.
func numbering(b string) map[string]map[string]numLevel {
	type lvl struct {
		Ilvl   string `xml:"ilvl,attr"`
		NumFmt struct {
			Val string `xml:"val,attr"`
		} `xml:"numFmt"`
		Start struct {
			Val string `xml:"val,attr"`
		} `xml:"start"`
	}
	var doc struct {
		Abstract []struct {
			ID   string `xml:"abstractNumId,attr"`
			Lvls []lvl  `xml:"lvl"`
		} `xml:"abstractNum"`
		Nums []struct {
			ID       string `xml:"numId,attr"`
			Abstract struct {
				Val string `xml:"val,attr"`
			} `xml:"abstractNumId"`
			Overrides []struct {
				Ilvl  string `xml:"ilvl,attr"`
				Start struct {
					Val string `xml:"val,attr"`
				} `xml:"startOverride"`
			} `xml:"lvlOverride"`
		} `xml:"num"`
	}
	out := map[string]map[string]numLevel{}
	if xml.Unmarshal([]byte(b), &doc) != nil {
		return out
	}
	abs := map[string]map[string]numLevel{}
	for _, a := range doc.Abstract {
		m := map[string]numLevel{}
		for _, l := range a.Lvls {
			start, err := strconv.Atoi(l.Start.Val)
			if err != nil {
				start = 1
			}
			m[l.Ilvl] = numLevel{numbered: l.NumFmt.Val != "bullet" && l.NumFmt.Val != "none" && l.NumFmt.Val != "", start: start}
		}
		abs[a.ID] = m
	}
	for _, n := range doc.Nums {
		m := map[string]numLevel{}
		for k, v := range abs[n.Abstract.Val] {
			m[k] = v
		}
		for _, o := range n.Overrides {
			if start, err := strconv.Atoi(o.Start.Val); err == nil {
				l := m[o.Ilvl]
				l.start = start
				m[o.Ilvl] = l
			}
		}
		out[n.ID] = m
	}
	return out
}

type docxReader struct {
	src    string
	d      *Doc
	styles map[string]string // styleId → name
	rels   map[string]office.Relationship
	nums   map[string]map[string]numLevel
	count  map[string][]int // numId → counters per level
	pics   int
	inCode bool // the last paragraph was code
}

func readDocx(p string) (*Doc, error) {
	pkg, err := office.ReadDocx(p)
	if err != nil {
		return nil, err
	}
	r := &docxReader{src: p, d: &Doc{}, styles: pkg.Styles, rels: map[string]office.Relationship{}, nums: numbering(pkg.Numbering), count: map[string][]int{}}
	for _, rel := range pkg.Rels {
		r.rels[rel.ID] = rel
	}
	if err := r.read(pkg.Document); err != nil {
		return nil, err
	}
	return r.d, nil
}

type docxPara struct {
	style      string
	numID      string
	ilvl       int
	hasNum     bool
	runs       []Inline
	pics       []Block
	bold, ital bool // the run being read
	strike     bool
	code       bool
	link       string
	alt        string // the next picture's description
	border     bool   // a paragraph border: on an empty paragraph, a rule
}

func (r *docxReader) read(document string) error {
	dec := xml.NewDecoder(strings.NewReader(document))
	var (
		para    *docxPara
		inText  bool
		tblRows [][][]Inline // the outermost table being read
		row     [][]Inline
		cell    []Inline
		tblDeep int
	)
	add := func(s string) {
		if para == nil || s == "" {
			return
		}
		para.runs = append(para.runs, Inline{Text: s, Bold: para.bold, Italic: para.ital, Strike: para.strike, Code: para.code, Link: para.link})
	}
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Space == nsMC && t.Name.Local == "Fallback" {
				dec.Skip()
				continue
			}
			if t.Name.Space != nsW {
				switch t.Name.Local {
				case "blip":
					if para != nil {
						r.picture(para, attrNS(t, nsR, "embed"))
					}
				case "imagedata":
					if para != nil {
						r.picture(para, attrNS(t, nsR, "id"))
					}
				case "docPr":
					if para != nil {
						para.alt = attrOf(t, "descr")
					}
				}
				continue
			}
			switch t.Name.Local {
			case "tbl":
				tblDeep++
				if tblDeep == 1 {
					tblRows = nil
				}
			case "tr":
				if tblDeep == 1 {
					row = nil
				}
			case "tc":
				if tblDeep == 1 {
					cell = nil
				}
			case "p":
				para = &docxPara{}
			case "pStyle":
				if para != nil {
					para.style = r.styles[attrNS(t, nsW, "val")]
				}
			case "numPr":
				if para != nil {
					para.hasNum = true
				}
			case "pBdr":
				if para != nil {
					para.border = true
				}
			case "numId":
				if para != nil {
					para.numID = attrNS(t, nsW, "val")
				}
			case "ilvl":
				if para != nil {
					para.ilvl, _ = strconv.Atoi(attrNS(t, nsW, "val"))
				}
			case "r":
				if para != nil {
					para.bold, para.ital, para.strike, para.code = false, false, false, false
				}
			case "rStyle":
				if para != nil {
					switch name := r.styles[attrNS(t, nsW, "val")]; {
					case name == "strong":
						para.bold = true
					case name == "emphasis":
						para.ital = true
					case strings.Contains(name, "code") || strings.Contains(name, "verbatim"):
						para.code = true
					}
				}
			case "b":
				if para != nil {
					para.bold = on(t)
				}
			case "i":
				if para != nil {
					para.ital = on(t)
				}
			case "strike", "dstrike":
				if para != nil {
					para.strike = on(t)
				}
			case "rFonts":
				if f := strings.ToLower(attrNS(t, nsW, "ascii")); para != nil && (strings.Contains(f, "mono") || f == "consolas" || f == "courier new") {
					para.code = true
				}
			case "hyperlink":
				if para != nil {
					if rel, ok := r.rels[attrNS(t, nsR, "id")]; ok && rel.External {
						para.link = rel.Target
					}
				}
			case "t":
				inText = true
			case "tab":
				add("\t")
			case "br", "cr":
				add("\n")
			case "noBreakHyphen":
				add("-")
			}
		case xml.CharData:
			if inText {
				add(string(t))
			}
		case xml.EndElement:
			if t.Name.Space != nsW {
				continue
			}
			switch t.Name.Local {
			case "t":
				inText = false
			case "hyperlink":
				if para != nil {
					para.link = ""
				}
			case "p":
				if para == nil {
					continue
				}
				if tblDeep > 0 {
					if len(cell) > 0 && len(para.runs) > 0 {
						cell = append(cell, Inline{Text: "\n"})
					}
					cell = append(cell, para.runs...)
				} else {
					r.paragraph(para)
				}
				para = nil
			case "tc":
				if tblDeep == 1 {
					row = append(row, merge(cell))
				}
			case "tr":
				if tblDeep == 1 {
					tblRows = append(tblRows, row)
				}
			case "tbl":
				tblDeep--
				if tblDeep == 0 && len(tblRows) > 0 {
					r.d.Blocks = append(r.d.Blocks, Block{Kind: Table, Rows: tblRows})
				}
			}
		}
	}
	return nil
}

var reHeadingStyle = regexp.MustCompile(`^heading ([1-6])$`)

func (r *docxReader) paragraph(p *docxPara) {
	runs := merge(p.runs)
	// Code continues over paragraphs in a row (one per line, as most
	// programs write it); any other paragraph, even an empty one, ends it.
	prevCode := r.inCode
	r.inCode = false
	b := Block{Kind: Para, Runs: runs}
	style := p.style
	switch m := reHeadingStyle.FindStringSubmatch(style); {
	case m != nil:
		b.Kind, b.Level = Heading, int(m[1][0]-'0')
	case style == "title":
		b.Kind, b.Level = Heading, 1
	case style == "subtitle":
		b.Kind, b.Level = Heading, 2
	case strings.Contains(style, "quote"):
		b.Kind = Quote
	case strings.Contains(style, "code") || strings.Contains(style, "preformatted"):
		b.Kind = Code
		b.Text = runsText(runs)
		b.Runs = nil
		r.inCode = true
		if n := len(r.d.Blocks); n > 0 && r.d.Blocks[n-1].Kind == Code && prevCode {
			r.d.Blocks[n-1].Text += "\n" + b.Text
			r.d.Blocks = append(r.d.Blocks, p.pics...)
			return
		}
	case p.hasNum && p.numID != "0", strings.HasPrefix(style, "list bullet"), strings.HasPrefix(style, "list number"):
		b.Kind, b.Level = ListItem, p.ilvl
		def := r.nums[p.numID][strconv.Itoa(p.ilvl)]
		if p.numID != "" {
			b.Ordered = def.numbered
		} else {
			b.Ordered = strings.HasPrefix(style, "list number")
		}
		// Counters per list and level; 0 means "not started".
		c := r.count[p.numID]
		for len(c) <= p.ilvl {
			c = append(c, 0)
		}
		if c[p.ilvl] == 0 {
			c[p.ilvl] = max(def.start, 1)
		} else {
			c[p.ilvl]++
		}
		for i := p.ilvl + 1; i < len(c); i++ {
			c[i] = 0
		}
		r.count[p.numID] = c
		b.Number = c[p.ilvl]
	}
	if b.Kind == Para && len(runs) == 0 && len(p.pics) == 0 {
		if p.border {
			r.d.Blocks = append(r.d.Blocks, Block{Kind: Rule})
		}
		return // empty paragraphs are spacing, which the writers make themselves
	}
	if len(runs) > 0 || b.Kind == Code {
		r.d.Blocks = append(r.d.Blocks, b)
	}
	r.d.Blocks = append(r.d.Blocks, p.pics...)
}

// picture takes an embedded picture out of the package into the
// conversion's temp folder.
func (r *docxReader) picture(p *docxPara, id string) {
	rel, ok := r.rels[id]
	if !ok || rel.External {
		return
	}
	b, err := office.ReadZipEntry(r.src, rel.Target, maxIn)
	if err != nil {
		return
	}
	if f := r.d.save(b, path.Ext(rel.Target), &r.pics); f != "" {
		alt := p.alt
		if alt == "" {
			alt = stemOf(rel.Target)
		}
		p.alt = ""
		p.pics = append(p.pics, Block{Kind: Picture, Text: f, Alt: alt})
	}
}

// save writes a picture from inside a document to the temp folder,
// returning its path ("" for formats nothing here can show, like EMF).
func (d *Doc) save(b []byte, ext string, n *int) string {
	ext = strings.ToLower(ext)
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff":
	default:
		return ""
	}
	if d.tmp == "" {
		dir, err := os.MkdirTemp("", "monoform-convert-")
		if err != nil {
			return ""
		}
		d.tmp = dir
	}
	*n++
	f := filepath.Join(d.tmp, fmt.Sprintf("picture-%d%s", *n, ext))
	if os.WriteFile(f, b, 0o600) != nil {
		return ""
	}
	return f
}

func readWordDoc(p string) (*Doc, error) {
	paras, err := office.ReadDoc(p)
	if err != nil {
		return nil, err
	}
	d := &Doc{}
	for _, t := range paras {
		if strings.TrimSpace(t) != "" {
			d.Blocks = append(d.Blocks, Block{Kind: Para, Runs: plain(t)})
		}
	}
	return d, nil
}

// ---------- writing .docx ----------

func xmlText(b *bytes.Buffer, s string) {
	xml.EscapeText(b, []byte(s))
}

type docxWriter struct {
	b       bytes.Buffer
	parts   []office.Part
	links   map[string]string // URL → relationship id
	nums    []string          // w:num elements
	listNum string            // the numbered list being written
	pics    int
	d       *Doc
}

// A4 with 2.5 cm margins: the text is 16 cm wide (in EMU for pictures).
const docxTextWidthEMU = 16 * 360000

func writeDocx(dst string, d *Doc) error {
	w := &docxWriter{links: map[string]string{}, d: d}
	w.b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	w.b.WriteString(`<w:document xmlns:w="` + nsW + `" xmlns:r="` + nsR + `" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>`)
	prev := Para
	for _, blk := range d.Blocks {
		w.block(blk, prev)
		prev = blk.Kind
	}
	if d.Landscape {
		w.b.WriteString(`<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`)
	} else {
		w.b.WriteString(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`)
	}
	w.b.WriteString(`</w:body></w:document>`)
	enc := base64.StdEncoding.EncodeToString
	parts := append([]office.Part{{Name: "word/styles.xml", Data: enc([]byte(docxStyles))}}, w.parts...)
	if len(w.nums) > 0 {
		parts = append(parts, office.Part{Name: "word/numbering.xml", RelID: "rIdNumbering", RelType: "numbering", Data: enc([]byte(docxNumbering(w.nums)))})
	}
	return office.WriteDocx(dst, "", w.b.String(), parts...)
}

func (w *docxWriter) block(blk Block, prev BlockKind) {
	b := &w.b
	switch blk.Kind {
	case Heading:
		fmt.Fprintf(b, `<w:p><w:pPr><w:pStyle w:val="Heading%d"/></w:pPr>`, min(max(blk.Level, 1), 6))
		w.runs(blk.Runs)
		b.WriteString(`</w:p>`)
	case Para:
		b.WriteString(`<w:p>`)
		w.runs(blk.Runs)
		b.WriteString(`</w:p>`)
	case Quote:
		b.WriteString(`<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>`)
		w.runs(blk.Runs)
		b.WriteString(`</w:p>`)
	case ListItem:
		num := "1" // bullets share one list
		if blk.Ordered {
			if prev != ListItem || w.listNum == "" || (blk.Level == 0 && blk.Number <= 1) {
				w.nums = append(w.nums, strconv.Itoa(max(blk.Number, 1)))
				w.listNum = strconv.Itoa(len(w.nums) + 1)
			}
			num = w.listNum
		} else if len(w.nums) == 0 {
			// numbering.xml is written once anything is a list.
			w.nums = append(w.nums, "")
		}
		if prev != ListItem && !blk.Ordered {
			w.listNum = ""
		}
		fmt.Fprintf(b, `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%s"/></w:numPr></w:pPr>`, min(blk.Level, 8), num)
		w.runs(blk.Runs)
		b.WriteString(`</w:p>`)
	case Code:
		if prev == Code {
			b.WriteString(`<w:p/>`) // two blocks of code stay two
		}
		b.WriteString(`<w:p><w:pPr><w:pStyle w:val="SourceCode"/></w:pPr>`)
		for i, line := range strings.Split(blk.Text, "\n") {
			if i > 0 {
				b.WriteString(`<w:r><w:br/></w:r>`)
			}
			b.WriteString(`<w:r><w:t xml:space="preserve">`)
			xmlText(b, strings.ReplaceAll(line, "\t", "    "))
			b.WriteString(`</w:t></w:r>`)
		}
		b.WriteString(`</w:p>`)
	case Rule:
		b.WriteString(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>`)
	case Table:
		w.table(blk.Rows)
	case Picture:
		w.picture(blk)
	}
}

func (w *docxWriter) runs(runs []Inline) {
	b := &w.b
	for _, r := range runs {
		if r.Text == "\n" {
			b.WriteString(`<w:r><w:br/></w:r>`)
			continue
		}
		link := ""
		if r.Link != "" && externalLink(r.Link) {
			link = w.links[r.Link]
			if link == "" {
				link = fmt.Sprintf("rIdLink%d", len(w.links)+1)
				w.links[r.Link] = link
				w.parts = append(w.parts, office.Part{External: true, RelID: link, RelType: "hyperlink", Target: r.Link})
			}
			fmt.Fprintf(b, `<w:hyperlink r:id="%s">`, link)
		}
		b.WriteString(`<w:r>`)
		if r.Bold || r.Italic || r.Strike || r.Code || link != "" {
			b.WriteString(`<w:rPr>`)
			switch {
			case r.Code:
				b.WriteString(`<w:rStyle w:val="VerbatimChar"/>`)
			case link != "":
				b.WriteString(`<w:rStyle w:val="Hyperlink"/>`)
			}
			if r.Bold {
				b.WriteString(`<w:b/>`)
			}
			if r.Italic {
				b.WriteString(`<w:i/>`)
			}
			if r.Strike {
				b.WriteString(`<w:strike/>`)
			}
			b.WriteString(`</w:rPr>`)
		}
		for i, part := range strings.Split(r.Text, "\t") {
			if i > 0 {
				b.WriteString(`<w:tab/>`)
			}
			if part != "" {
				b.WriteString(`<w:t xml:space="preserve">`)
				xmlText(b, part)
				b.WriteString(`</w:t>`)
			}
		}
		b.WriteString(`</w:r>`)
		if link != "" {
			b.WriteString(`</w:hyperlink>`)
		}
	}
}

var reExternal = regexp.MustCompile(`(?i)^(https?://|mailto:)\S+$`)

func externalLink(u string) bool { return reExternal.MatchString(u) }

func (w *docxWriter) table(rows [][][]Inline) {
	cols := 0
	for _, r := range rows {
		cols = max(cols, len(r))
	}
	if cols == 0 {
		return
	}
	b := &w.b
	b.WriteString(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>`)
	for range cols {
		fmt.Fprintf(b, `<w:gridCol w:w="%d"/>`, 9070/cols)
	}
	b.WriteString(`</w:tblGrid>`)
	for i, r := range rows {
		b.WriteString(`<w:tr>`)
		if i == 0 {
			b.WriteString(`<w:trPr><w:tblHeader/></w:trPr>`)
		}
		for c := range cols {
			b.WriteString(`<w:tc><w:p>`)
			if c < len(r) {
				runs := r[c]
				if i == 0 && len(rows) > 1 {
					runs = append([]Inline(nil), runs...)
					for k := range runs {
						runs[k].Bold = true
					}
				}
				w.runs(runs)
			}
			b.WriteString(`</w:p></w:tc>`)
		}
		b.WriteString(`</w:tr>`)
	}
	b.WriteString(`</w:tbl><w:p/>`)
}

// picture embeds a picture at its size (at 96 dpi), no wider than the text.
// Formats Word may not show (WebP, TIFF, BMP) go in as PNG.
func (w *docxWriter) picture(blk Block) {
	p := w.d.picturePath(blk.Text)
	if p == "" {
		if blk.Alt != "" {
			w.block(Block{Kind: Para, Runs: []Inline{{Text: blk.Alt, Italic: true}}}, Para)
		}
		return
	}
	data, ext, cfg, err := pictureData(p)
	if err != nil {
		return
	}
	w.pics++
	id := fmt.Sprintf("rIdPic%d", w.pics)
	name := fmt.Sprintf("word/media/converted%d.%s", w.pics, ext)
	w.parts = append(w.parts, office.Part{Name: name, RelID: id, RelType: "image", Data: base64.StdEncoding.EncodeToString(data)})
	cx, cy := int64(cfg.Width)*9525, int64(cfg.Height)*9525 // 96 dpi
	if cx > docxTextWidthEMU {
		cy = cy * docxTextWidthEMU / cx
		cx = docxTextWidthEMU
	}
	var alt bytes.Buffer
	xmlText(&alt, blk.Alt)
	fmt.Fprintf(&w.b, `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="Picture %d" descr="%s"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="%d" name="Picture %d"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
		cx, cy, w.pics, w.pics, alt.String(), w.pics, w.pics, id, cx, cy)
}

// pictureData reads a picture for embedding: PNG, JPEG and GIF as they
// are, anything else as PNG.
func pictureData(p string) ([]byte, string, image.Config, error) {
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, "", image.Config{}, err
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return nil, "", cfg, err
	}
	switch format {
	case "png", "gif":
		return b, format, cfg, nil
	case "jpeg":
		return b, "jpg", cfg, nil
	}
	out, err := imaging.TranscodeBytes(b, imaging.Options{Format: "png"})
	return out, "png", cfg, err
}

// The styles a converted document uses, close to what Word starts with.
const docxStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
	`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:b/><w:sz w:val="36"/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:b/><w:sz w:val="30"/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:b/><w:sz w:val="26"/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D0D0D0"/></w:pBdr><w:ind w:left="284"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F3F3"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/><w:ind w:left="113" w:right="113"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>` +
	`<w:style w:type="character" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F3F3F3"/></w:rPr></w:style>` +
	`<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
	`<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
	`</w:styles>`

// docxNumbering writes the list definitions: numId 1 is the bulleted list,
// every numbered list after it gets its own numId (starting at its first
// item's number) so each one counts from its own start.
func docxNumbering(starts []string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" + `<w:numbering xmlns:w="` + nsW + `">`)
	bullets := []string{"•", "◦", "▪"}
	b.WriteString(`<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>`)
	for l := range 9 {
		fmt.Fprintf(&b, `<w:lvl w:ilvl="%d"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="%s"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="%d" w:hanging="284"/></w:pPr></w:lvl>`, l, bullets[l%3], 567+l*425)
	}
	b.WriteString(`</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>`)
	formats := []string{"decimal", "lowerLetter", "lowerRoman"}
	for l := range 9 {
		fmt.Fprintf(&b, `<w:lvl w:ilvl="%d"><w:start w:val="1"/><w:numFmt w:val="%s"/><w:lvlText w:val="%%%d."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="%d" w:hanging="360"/></w:pPr></w:lvl>`, l, formats[l%3], l+1, 567+l*425)
	}
	b.WriteString(`</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`)
	for i, s := range starts {
		if s == "" {
			continue
		}
		fmt.Fprintf(&b, `<w:num w:numId="%d"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="%s"/></w:lvlOverride></w:num>`, i+2, s)
	}
	b.WriteString(`</w:numbering>`)
	return b.String()
}
