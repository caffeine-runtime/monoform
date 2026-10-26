package convert

import (
	"encoding/xml"
	"path"
	"strconv"
	"strings"

	"github.com/caffeine-runtime/monoform/internal/office"
)

const (
	nsOText  = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
	nsOTable = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
	nsOStyle = "urn:oasis:names:tc:opendocument:xmlns:style:1.0"
	nsOFO    = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
	nsODraw  = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
	nsOOff   = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
	nsXLink  = "http://www.w3.org/1999/xlink"
)

// odtStyle is what a content.xml automatic style says: its parent (a named
// style) and its text formatting.
type odtStyle struct {
	parent                     string
	bold, italic, strike, mono bool
}

type odtReader struct {
	src   string
	d     *Doc
	named map[string]string // named paragraph style → display name
	flags map[string]string // named text style → "b i s"
	auto  map[string]odtStyle
	lists map[string]map[int]bool // list style → level → numbered
	pics  int
}

func readOdt(p string) (*Doc, error) {
	pkg, err := office.ReadOdt(p)
	if err != nil {
		return nil, err
	}
	r := &odtReader{src: p, d: &Doc{}, named: pkg.Styles, flags: pkg.TextStyles, auto: map[string]odtStyle{}, lists: map[string]map[int]bool{}}
	r.read(pkg.Content)
	return r.d, nil
}

// styleName is a paragraph style's display name, through its automatic
// style ("P1" → "heading 1").
func (r *odtReader) styleName(s string) string {
	if a, ok := r.auto[s]; ok && a.parent != "" {
		s = a.parent
	}
	if n, ok := r.named[s]; ok {
		return n
	}
	return strings.ToLower(strings.ReplaceAll(s, "_20_", " "))
}

type odtSpan struct{ bold, italic, strike, code bool }

func (r *odtReader) spanOf(name string, outer odtSpan) odtSpan {
	s := outer
	if a, ok := r.auto[name]; ok {
		s.bold, s.italic, s.strike, s.code = s.bold || a.bold, s.italic || a.italic, s.strike || a.strike, s.code || a.mono
		name = a.parent
	}
	f := " " + r.flags[name] + " "
	s.bold = s.bold || strings.Contains(f, " b ")
	s.italic = s.italic || strings.Contains(f, " i ")
	s.strike = s.strike || strings.Contains(f, " s ")
	n := strings.ToLower(name)
	s.code = s.code || strings.Contains(n, "source") || strings.Contains(n, "code") || strings.Contains(n, "teletype")
	return s
}

func (r *odtReader) read(content string) {
	dec := xml.NewDecoder(strings.NewReader(content))
	type listLevel struct {
		style string
		count int
	}
	var (
		lists   []listLevel
		spans   []odtSpan
		link    string
		runs    []Inline
		pics    []Block
		inPara  bool
		kind    BlockKind
		level   int
		style   string
		tblDeep int
		rows    [][][]Inline
		row     [][]Inline
		cell    []Inline
	)
	cur := func() odtSpan {
		if len(spans) == 0 {
			return odtSpan{}
		}
		return spans[len(spans)-1]
	}
	add := func(s string) {
		if !inPara || s == "" {
			return
		}
		sp := cur()
		runs = append(runs, Inline{Text: s, Bold: sp.bold, Italic: sp.italic, Strike: sp.strike, Code: sp.code, Link: link})
	}
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Space {
			case nsOStyle:
				switch t.Name.Local {
				case "style":
					r.autoStyle(dec, t)
				}
			case nsOText:
				switch t.Name.Local {
				case "list-style":
					r.listStyle(dec, t)
				case "list":
					st := attrNS(t, nsOText, "style-name")
					if st == "" && len(lists) > 0 {
						st = lists[len(lists)-1].style
					}
					lists = append(lists, listLevel{style: st})
				case "list-item":
					if len(lists) > 0 {
						lists[len(lists)-1].count++
					}
				case "h", "p":
					if tblDeep > 0 && inPara {
						continue
					}
					inPara, runs, pics = true, nil, nil
					style = r.styleName(attrNS(t, nsOText, "style-name"))
					spans = []odtSpan{r.spanOf(attrNS(t, nsOText, "style-name"), odtSpan{})}
					kind, level = Para, 0
					if t.Name.Local == "h" {
						kind = Heading
						level, _ = strconv.Atoi(attrNS(t, nsOText, "outline-level"))
						level = min(max(level, 1), 6)
					}
				case "span":
					spans = append(spans, r.spanOf(attrNS(t, nsOText, "style-name"), cur()))
				case "a":
					link = attrNS(t, nsXLink, "href")
				case "s":
					n, _ := strconv.Atoi(attrNS(t, nsOText, "c"))
					add(strings.Repeat(" ", max(n, 1)))
				case "tab":
					add("\t")
				case "line-break":
					add("\n")
				case "note", "tracked-changes":
					dec.Skip()
				}
			case nsOOff:
				if t.Name.Local == "annotation" {
					dec.Skip()
				}
			case nsOTable:
				switch t.Name.Local {
				case "table":
					tblDeep++
					if tblDeep == 1 {
						rows = nil
					}
				case "table-row":
					if tblDeep == 1 {
						row = nil
					}
				case "table-cell":
					if tblDeep == 1 {
						cell = nil
					}
				}
			case nsODraw:
				if t.Name.Local == "image" && inPara {
					href := attrNS(t, nsXLink, "href")
					if !strings.Contains(href, "://") {
						if b, err := office.ReadZipEntry(r.src, strings.TrimPrefix(href, "./"), maxIn); err == nil {
							if f := r.d.save(b, path.Ext(href), &r.pics); f != "" {
								pics = append(pics, Block{Kind: Picture, Text: f, Alt: stemOf(href)})
							}
						}
					}
					dec.Skip()
				}
			}
		case xml.CharData:
			add(string(t))
		case xml.EndElement:
			switch t.Name.Space {
			case nsOText:
				switch t.Name.Local {
				case "span":
					if len(spans) > 1 {
						spans = spans[:len(spans)-1]
					}
				case "a":
					link = ""
				case "list":
					if len(lists) > 0 {
						lists = lists[:len(lists)-1]
					}
				case "h", "p":
					if !inPara {
						continue
					}
					inPara = false
					runs = merge(runs)
					if tblDeep > 0 {
						if len(cell) > 0 && len(runs) > 0 {
							cell = append(cell, Inline{Text: "\n"})
						}
						cell = append(cell, runs...)
						continue
					}
					b := Block{Kind: kind, Level: level, Runs: runs}
					switch {
					case kind == Heading:
					case len(lists) > 0:
						l := lists[len(lists)-1]
						b.Kind, b.Level = ListItem, len(lists)-1
						b.Ordered, b.Number = r.lists[lists[0].style][len(lists)], l.count
					case strings.HasPrefix(style, "heading "):
						b.Kind = Heading
						b.Level, _ = strconv.Atoi(strings.TrimPrefix(style, "heading "))
						b.Level = min(max(b.Level, 1), 6)
					case style == "title":
						b.Kind, b.Level = Heading, 1
					case strings.Contains(style, "quotation") || strings.Contains(style, "quote"):
						b.Kind = Quote
					case strings.Contains(style, "preformatted") || strings.Contains(style, "source"):
						b.Kind, b.Text, b.Runs = Code, runsText(runs), nil
						if n := len(r.d.Blocks); n > 0 && r.d.Blocks[n-1].Kind == Code {
							r.d.Blocks[n-1].Text += "\n" + b.Text
							r.d.Blocks = append(r.d.Blocks, pics...)
							continue
						}
					}
					if len(b.Runs) > 0 || b.Kind == Code {
						r.d.Blocks = append(r.d.Blocks, b)
					}
					r.d.Blocks = append(r.d.Blocks, pics...)
				}
			case nsOTable:
				switch t.Name.Local {
				case "table-cell":
					if tblDeep == 1 {
						row = append(row, merge(cell))
					}
				case "table-row":
					if tblDeep == 1 {
						rows = append(rows, row)
					}
				case "table":
					tblDeep--
					if tblDeep == 0 && len(rows) > 0 {
						r.d.Blocks = append(r.d.Blocks, Block{Kind: Table, Rows: rows})
					}
				}
			}
		}
	}
}

// autoStyle reads one style:style of content.xml (its start tag consumed).
func (r *odtReader) autoStyle(dec *xml.Decoder, se xml.StartElement) {
	s := odtStyle{parent: attrNS(se, nsOStyle, "parent-style-name")}
	name := attrNS(se, nsOStyle, "name")
	for depth := 1; depth > 0; {
		tok, err := dec.Token()
		if err != nil {
			return
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			if t.Name.Local != "text-properties" {
				continue
			}
			if w := attrNS(t, nsOFO, "font-weight"); w == "bold" || w >= "600" && w <= "900" {
				s.bold = true
			}
			if v := attrNS(t, nsOFO, "font-style"); v == "italic" || v == "oblique" {
				s.italic = true
			}
			if v := attrNS(t, nsOStyle, "text-line-through-style"); v != "" && v != "none" {
				s.strike = true
			}
			if f := strings.ToLower(attrNS(t, nsOStyle, "font-name")); strings.Contains(f, "mono") || strings.Contains(f, "courier") || strings.Contains(f, "consolas") {
				s.mono = true
			}
		case xml.EndElement:
			depth--
		}
	}
	r.auto[name] = s
}

// listStyle reads whether each level of a list style is numbered.
func (r *odtReader) listStyle(dec *xml.Decoder, se xml.StartElement) {
	levels := map[int]bool{}
	for depth := 1; depth > 0; {
		tok, err := dec.Token()
		if err != nil {
			return
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			if t.Name.Local == "list-level-style-number" {
				l, _ := strconv.Atoi(attrNS(t, nsOText, "level"))
				levels[l] = attrNS(t, nsOStyle, "num-format") != ""
			}
		case xml.EndElement:
			depth--
		}
	}
	r.lists[attrNS(se, nsOStyle, "name")] = levels
}
