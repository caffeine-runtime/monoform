package convert

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
	xunicode "golang.org/x/text/encoding/unicode"
)

// decodeText reads UTF-8 (with or without a BOM), UTF-16 with a BOM, or
// else Windows-1252, which is what text files without a BOM mostly are.
func decodeText(b []byte) []byte {
	switch {
	case bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}):
		return b[3:]
	case bytes.HasPrefix(b, []byte{0xFF, 0xFE}), bytes.HasPrefix(b, []byte{0xFE, 0xFF}):
		if out, err := xunicode.UTF16(xunicode.LittleEndian, xunicode.UseBOM).NewDecoder().Bytes(b); err == nil {
			return out
		}
	case !utf8.Valid(b):
		if out, err := charmap.Windows1252.NewDecoder().Bytes(b); err == nil {
			return out
		}
	}
	return b
}

var (
	reFence    = regexp.MustCompile("^\\s*(`{3,}|~{3,})")
	reATX      = regexp.MustCompile(`^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$`)
	reSetext1  = regexp.MustCompile(`^ {0,3}=+[ \t]*$`)
	reSetext2  = regexp.MustCompile(`^ {0,3}-+[ \t]*$`)
	reRule     = regexp.MustCompile(`^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$`)
	reQuote    = regexp.MustCompile(`^ {0,3}> ?`)
	reItem     = regexp.MustCompile(`^([ \t]*)([-*+]|[0-9]{1,9}[.)])(?:[ \t]+(.*))?$`)
	reTableSep = regexp.MustCompile(`^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$`)
	reRefDef   = regexp.MustCompile(`^ {0,3}\[([^\]]+)\]:[ \t]*<?(\S+?)>?(?:[ \t]+["'(].*["')])?[ \t]*$`)
	rePicture  = regexp.MustCompile(`^!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)$`)
	reWikiPic  = regexp.MustCompile(`^!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$`)
)

func indentOf(s string) int {
	n := 0
	for _, c := range s {
		switch c {
		case ' ':
			n++
		case '\t':
			n += 4 - n%4
		default:
			return n
		}
	}
	return n
}

type mdParser struct {
	refs map[string]string
}

// ParseMarkdown reads the Markdown the app's notes use: headings, lists
// (nested, numbered, tasks), quotes, code, tables, pictures, links,
// emphasis. Front matter is left out; HTML is kept as text, like the
// preview shows it.
func ParseMarkdown(s string) *Doc {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	lines := strings.Split(s, "\n")
	// Front matter.
	if len(lines) > 1 && strings.TrimSpace(lines[0]) == "---" {
		for i := 1; i < len(lines) && i < 400; i++ {
			if t := strings.TrimSpace(lines[i]); t == "---" || t == "..." {
				lines = lines[i+1:]
				break
			}
		}
	}
	p := &mdParser{refs: map[string]string{}}
	kept := lines[:0:0]
	inFence := ""
	for _, l := range lines {
		if m := reFence.FindStringSubmatch(l); m != nil {
			switch {
			case inFence == "":
				inFence = m[1][:1]
			case strings.HasPrefix(m[1], inFence):
				inFence = ""
			}
		}
		if inFence == "" {
			if m := reRefDef.FindStringSubmatch(l); m != nil {
				p.refs[strings.ToLower(m[1])] = m[2]
				continue
			}
		}
		kept = append(kept, l)
	}
	return &Doc{Blocks: p.blocks(kept)}
}

func (p *mdParser) blocks(lines []string) []Block {
	var out []Block
	var para []string
	flush := func() {
		if len(para) == 0 {
			return
		}
		var b strings.Builder
		for i, l := range para {
			hard := strings.HasSuffix(l, "  ") || strings.HasSuffix(l, "\\")
			l = strings.TrimSpace(l)
			if hard {
				l = strings.TrimSuffix(l, "\\")
			}
			b.WriteString(l)
			if i < len(para)-1 {
				if hard {
					b.WriteString("\n")
				} else {
					b.WriteString(" ")
				}
			}
		}
		para = nil
		out = append(out, p.paragraph(b.String(), Para))
	}
	var listIndents []int // the open lists' marker indents
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			flush()
			// A blank line ends a list unless an item or indented text follows.
			if j := nextNonBlank(lines, i); j < 0 || (!reItem.MatchString(lines[j]) && indentOf(lines[j]) < 2) {
				listIndents = nil
			}
			continue
		}
		if strings.HasPrefix(trimmed, "<!--") {
			flush()
			for ; i < len(lines) && !strings.Contains(lines[i], "-->"); i++ {
			}
			continue
		}
		if m := reFence.FindStringSubmatch(line); m != nil {
			flush()
			fence, ind := m[1], indentOf(line)
			var code []string
			for i++; i < len(lines); i++ {
				if t := strings.TrimSpace(lines[i]); strings.HasPrefix(t, fence) && strings.Trim(t, fence[:1]) == "" {
					break
				}
				code = append(code, dedent(lines[i], ind))
			}
			out = append(out, Block{Kind: Code, Text: strings.Join(code, "\n")})
			continue
		}
		if len(para) > 0 && len(listIndents) == 0 {
			if reSetext1.MatchString(line) || reSetext2.MatchString(line) {
				level := 1
				if strings.HasPrefix(trimmed, "-") {
					level = 2
				}
				text := strings.TrimSpace(strings.Join(para, " "))
				para = nil
				out = append(out, p.heading(text, level))
				continue
			}
		}
		if m := reATX.FindStringSubmatch(line); m != nil {
			flush()
			listIndents = nil
			out = append(out, p.heading(m[2], len(m[1])))
			continue
		}
		if reRule.MatchString(line) {
			flush()
			listIndents = nil
			out = append(out, Block{Kind: Rule})
			continue
		}
		if strings.Contains(line, "|") && i+1 < len(lines) && reTableSep.MatchString(lines[i+1]) && strings.Contains(lines[i+1], "-") {
			flush()
			listIndents = nil
			t := Block{Kind: Table}
			t.Rows = append(t.Rows, p.tableRow(line))
			for i += 2; i < len(lines) && strings.Contains(lines[i], "|") && strings.TrimSpace(lines[i]) != ""; i++ {
				t.Rows = append(t.Rows, p.tableRow(lines[i]))
			}
			i--
			out = append(out, t)
			continue
		}
		if reQuote.MatchString(line) {
			flush()
			listIndents = nil
			var inner []string
			for ; i < len(lines) && reQuote.MatchString(lines[i]); i++ {
				inner = append(inner, reQuote.ReplaceAllString(lines[i], ""))
			}
			i--
			for _, b := range p.blocks(inner) {
				if b.Kind == Para {
					b.Kind = Quote
				}
				out = append(out, b)
			}
			continue
		}
		if m := reItem.FindStringSubmatch(line); m != nil && (len(para) == 0 || len(listIndents) > 0 || m[3] != "") {
			flush()
			ind := indentOf(m[1])
			for len(listIndents) > 0 && ind < listIndents[len(listIndents)-1] {
				listIndents = listIndents[:len(listIndents)-1]
			}
			if len(listIndents) == 0 || ind >= listIndents[len(listIndents)-1]+2 {
				listIndents = append(listIndents, ind)
			}
			item := Block{Kind: ListItem, Level: len(listIndents) - 1}
			if n, err := strconv.Atoi(strings.TrimRight(m[2], ".)")); err == nil {
				item.Ordered, item.Number = true, n
			}
			text := m[3]
			switch {
			case strings.HasPrefix(text, "[ ] "):
				text = "☐ " + text[4:]
			case strings.HasPrefix(text, "[x] "), strings.HasPrefix(text, "[X] "):
				text = "☑ " + text[4:]
			}
			// Continuation lines: indented, or lazily following the item.
			for i+1 < len(lines) {
				next := lines[i+1]
				nt := strings.TrimSpace(next)
				if nt == "" || reItem.MatchString(next) || reFence.MatchString(next) || reATX.MatchString(next) || reQuote.MatchString(next) || reRule.MatchString(next) {
					break
				}
				text += " " + nt
				i++
			}
			item.Runs = p.inline(strings.TrimSpace(text))
			out = append(out, item)
			continue
		}
		if len(listIndents) > 0 && indentOf(line) >= 2 && len(para) == 0 {
			// A later paragraph of a list item: kept with it.
			if n := len(out); n > 0 && out[n-1].Kind == ListItem {
				out[n-1].Runs = append(out[n-1].Runs, Inline{Text: "\n"})
				out[n-1].Runs = append(out[n-1].Runs, p.inline(trimmed)...)
				continue
			}
		}
		if indentOf(line) >= 4 && len(para) == 0 && len(listIndents) == 0 {
			var code []string
			for ; i < len(lines) && (indentOf(lines[i]) >= 4 || strings.TrimSpace(lines[i]) == ""); i++ {
				code = append(code, dedent(lines[i], 4))
			}
			i--
			for len(code) > 0 && strings.TrimSpace(code[len(code)-1]) == "" {
				code = code[:len(code)-1]
			}
			out = append(out, Block{Kind: Code, Text: strings.Join(code, "\n")})
			continue
		}
		listIndents = nil
		para = append(para, line)
	}
	flush()
	return out
}

func nextNonBlank(lines []string, i int) int {
	for j := i + 1; j < len(lines); j++ {
		if strings.TrimSpace(lines[j]) != "" {
			return j
		}
	}
	return -1
}

// dedent removes up to n columns of leading whitespace.
func dedent(s string, n int) string {
	col := 0
	for i, c := range s {
		if col >= n || (c != ' ' && c != '\t') {
			return s[i:]
		}
		if c == '\t' {
			col += 4 - col%4
		} else {
			col++
		}
	}
	return ""
}

func (p *mdParser) heading(text string, level int) Block {
	return Block{Kind: Heading, Level: level, Runs: p.inline(strings.TrimSpace(text))}
}

// paragraph makes a block of a paragraph's text: a picture on its own
// becomes a picture block.
func (p *mdParser) paragraph(text string, kind BlockKind) Block {
	if m := rePicture.FindStringSubmatch(text); m != nil {
		return Block{Kind: Picture, Text: unescapeURL(m[2] + m[3]), Alt: m[1]}
	}
	if m := reWikiPic.FindStringSubmatch(text); m != nil {
		return Block{Kind: Picture, Text: m[1], Alt: stemOf(m[1])}
	}
	return Block{Kind: kind, Runs: p.inline(text)}
}

func unescapeURL(s string) string {
	return strings.ReplaceAll(s, "%20", " ")
}

func (p *mdParser) tableRow(line string) [][]Inline {
	line = strings.TrimSpace(line)
	line = strings.TrimPrefix(line, "|")
	if strings.HasSuffix(line, "|") && !strings.HasSuffix(line, `\|`) {
		line = line[:len(line)-1]
	}
	var cells [][]Inline
	var cur strings.Builder
	inCode := false
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case c == '\\' && i+1 < len(line) && line[i+1] == '|':
			cur.WriteByte('|')
			i++
			continue
		case c == '`':
			inCode = !inCode
		case c == '|' && !inCode:
			cells = append(cells, p.inline(strings.TrimSpace(cur.String())))
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	return append(cells, p.inline(strings.TrimSpace(cur.String())))
}

// inline parses emphasis, code, links and line breaks into runs.
func (p *mdParser) inline(s string) []Inline {
	var out []Inline
	p.inlineInto(&out, s, Inline{})
	return merge(out)
}

func (p *mdParser) inlineInto(out *[]Inline, s string, st Inline) {
	var text strings.Builder
	emit := func() {
		if text.Len() > 0 {
			r := st
			r.Text = typography(text.String())
			*out = append(*out, r)
			text.Reset()
		}
	}
	for i := 0; i < len(s); {
		c := s[i]
		rest := s[i:]
		switch {
		case c == '\\' && i+1 < len(s) && strings.IndexByte("\\`*_{}[]()#+-.!|~<>\"'", s[i+1]) >= 0:
			text.WriteByte(s[i+1])
			i += 2
			continue
		case c == '\n':
			emit()
			*out = append(*out, Inline{Text: "\n"})
			i++
			continue
		case c == '`':
			n := len(rest) - len(strings.TrimLeft(rest, "`"))
			fence := rest[:n]
			if j := strings.Index(rest[n:], fence); j >= 0 {
				emit()
				code := rest[n : n+j]
				if len(code) > 1 && code[0] == ' ' && code[len(code)-1] == ' ' {
					code = code[1 : len(code)-1]
				}
				r := st
				r.Text, r.Code = code, true
				*out = append(*out, r)
				i += n + j + n
				continue
			}
			text.WriteString(fence)
			i += n
			continue
		case strings.HasPrefix(rest, "![["), strings.HasPrefix(rest, "[["):
			start := 2
			if c == '!' {
				start = 3
			}
			if j := strings.Index(rest, "]]"); j > start {
				target := rest[start:j]
				label := target
				if k := strings.Index(target, "|"); k >= 0 {
					label = target[k+1:]
				}
				text.WriteString(label)
				i += j + 2
				continue
			}
		case c == '!' && strings.HasPrefix(rest, "!["):
			if label, _, n := p.link(rest[1:]); n > 0 {
				text.WriteString(label)
				i += 1 + n
				continue
			}
		case c == '[':
			if label, url, n := p.link(rest); n > 0 {
				emit()
				ls := st
				ls.Link = url
				p.inlineInto(out, label, ls)
				i += n
				continue
			}
		case c == '<':
			if j := strings.IndexByte(rest, '>'); j > 0 {
				u := rest[1:j]
				if strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "mailto:") {
					emit()
					r := st
					r.Text, r.Link = strings.TrimPrefix(u, "mailto:"), u
					*out = append(*out, r)
					i += j + 1
					continue
				}
			}
		case (c == 'h') && (strings.HasPrefix(rest, "https://") || strings.HasPrefix(rest, "http://")) && st.Link == "" && (i == 0 || !isWordByte(s[i-1])):
			j := strings.IndexFunc(rest, func(r rune) bool { return unicode.IsSpace(r) || r == '<' })
			if j < 0 {
				j = len(rest)
			}
			u := strings.TrimRight(rest[:j], ".,;:!?\"'")
			if strings.HasSuffix(u, ")") && !strings.Contains(u, "(") {
				u = u[:len(u)-1]
			}
			emit()
			r := st
			r.Text, r.Link = u, u
			*out = append(*out, r)
			i += len(u)
			continue
		case c == '*' || c == '_' || c == '~':
			n := len(rest) - len(strings.TrimLeft(rest, string(c)))
			if c == '~' && n != 2 {
				break
			}
			n = min(n, 3)
			delim := rest[:n]
			// Emphasis opens before text, and "_" not inside a word.
			if i+n < len(s) && s[i+n] != ' ' && !(c == '_' && i > 0 && isWordByte(s[i-1])) {
				if j := closing(s, i+n, delim); j > 0 {
					emit()
					in := st
					switch {
					case c == '~':
						in.Strike = true
					case n == 1:
						in.Italic = true
					case n == 2:
						in.Bold = true
					default:
						in.Bold, in.Italic = true, true
					}
					p.inlineInto(out, s[i+n:j], in)
					i = j + n
					continue
				}
			}
			text.WriteString(delim)
			i += n
			continue
		}
		_, size := utf8.DecodeRuneInString(rest)
		text.WriteString(rest[:size])
		i += size
	}
	emit()
}

func isWordByte(b byte) bool {
	return b == '_' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= 0x80
}

// closing finds the delimiter run that closes emphasis opened before from.
func closing(s string, from int, delim string) int {
	for j := from; j < len(s); j++ {
		if s[j] == '`' { // code spans don't close emphasis
			n := len(s[j:]) - len(strings.TrimLeft(s[j:], "`"))
			if k := strings.Index(s[j+n:], s[j:j+n]); k >= 0 {
				j += n + k + n - 1
				continue
			}
		}
		if s[j] == '\\' {
			j++
			continue
		}
		if !strings.HasPrefix(s[j:], delim) || s[j-1] == ' ' {
			continue
		}
		// A longer run (** inside *…*) isn't this one's end, unless it ends here.
		end := j + len(delim)
		if end < len(s) && s[end] == delim[0] {
			k := end
			for k < len(s) && s[k] == delim[0] {
				k++
			}
			if k < len(s) {
				j = k - 1
				continue
			}
			return k - len(delim)
		}
		if delim[0] == '_' && end < len(s) && isWordByte(s[end]) {
			continue
		}
		return j
	}
	return -1
}

// link parses [label](url "title"), [label][ref] or [ref] at the start of
// s, returning how many bytes it took (0: not a link).
func (p *mdParser) link(s string) (label, url string, n int) {
	depth := 0
	end := -1
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\\':
			i++
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				end = i
			}
		}
		if end >= 0 {
			break
		}
	}
	if end < 0 {
		return "", "", 0
	}
	label = s[1:end]
	rest := s[end+1:]
	if strings.HasPrefix(rest, "(") {
		depth := 0
		for j := 0; j < len(rest); j++ {
			switch rest[j] {
			case '(':
				depth++
			case ')':
				depth--
				if depth == 0 {
					target := strings.TrimSpace(rest[1:j])
					if k := strings.IndexAny(target, " \t"); k >= 0 {
						target = target[:k]
					}
					return label, strings.Trim(target, "<>"), end + 1 + j + 1
				}
			}
		}
		return "", "", 0
	}
	if strings.HasPrefix(rest, "[") {
		if j := strings.IndexByte(rest, ']'); j >= 0 {
			ref := rest[1:j]
			if ref == "" {
				ref = label
			}
			if u, ok := p.refs[strings.ToLower(ref)]; ok {
				return label, u, end + 1 + j + 1
			}
		}
	}
	if u, ok := p.refs[strings.ToLower(label)]; ok {
		return label, u, end + 1
	}
	return "", "", 0
}

var typo = strings.NewReplacer("---", "—", "--", "–", "...", "…", "(c)", "©", "(C)", "©", "(tm)", "™", "(TM)", "™", "(r)", "®", "(R)", "®")

// typography makes the replacements the preview makes (dashes, ellipsis).
func typography(s string) string {
	if !strings.ContainsAny(s, "-.(") {
		return s
	}
	return typo.Replace(s)
}

// merge joins neighbouring runs of the same style.
func merge(runs []Inline) []Inline {
	var out []Inline
	for _, r := range runs {
		if r.Text == "" {
			continue
		}
		if n := len(out); n > 0 && r.Text != "\n" && out[n-1].Text != "\n" && sameStyle(out[n-1], r) {
			out[n-1].Text += r.Text
			continue
		}
		out = append(out, r)
	}
	return out
}

func sameStyle(a, b Inline) bool {
	return a.Bold == b.Bold && a.Italic == b.Italic && a.Strike == b.Strike && a.Code == b.Code && a.Link == b.Link
}
