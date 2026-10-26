package convert

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"html"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/caffeine-runtime/monoform/internal/fs"
)

// ---------- Markdown ----------

var mdEscaper = strings.NewReplacer(`\`, `\\`, "`", "\\`", "*", `\*`, "_", `\_`, "[", `\[`, "]", `\]`, "<", `\<`)

func mdEscape(s string, lineStart bool) string {
	s = mdEscaper.Replace(s)
	if lineStart {
		// What would start a heading, list or quote at the start of a line.
		t := strings.TrimLeft(s, " ")
		switch {
		case strings.HasPrefix(t, "#"), strings.HasPrefix(t, ">"), strings.HasPrefix(t, "- "), strings.HasPrefix(t, "+ "):
			s = `\` + t
		default:
			if i := strings.IndexAny(t, ".)"); i > 0 && i < 10 && strings.Trim(t[:i], "0123456789") == "" && strings.HasPrefix(t[i+1:], " ") {
				s = t[:i] + `\` + t[i:]
			}
		}
	}
	return s
}

func mdRuns(runs []Inline) string {
	var b strings.Builder
	for i, r := range runs {
		if r.Text == "\n" {
			b.WriteString("  \n")
			continue
		}
		atStart := i == 0 || runs[i-1].Text == "\n"
		text := r.Text
		if r.Code {
			fence := "`"
			for strings.Contains(text, fence) {
				fence += "`"
			}
			pad := ""
			if strings.HasPrefix(text, "`") || strings.HasSuffix(text, "`") {
				pad = " "
			}
			text = fence + pad + text + pad + fence
		} else {
			// Emphasis can't start or end with a space: keep those outside.
			lead := text[:len(text)-len(strings.TrimLeft(text, " "))]
			trail := text[len(strings.TrimRight(text, " ")):]
			core := mdEscape(strings.TrimSpace(text), atStart && lead == "")
			if core == "" {
				b.WriteString(text)
				continue
			}
			if r.Strike {
				core = "~~" + core + "~~"
			}
			if r.Italic {
				core = "*" + core + "*"
			}
			if r.Bold {
				core = "**" + core + "**"
			}
			text = lead + core + trail
		}
		switch {
		case r.Link == "":
		case !r.Code && (r.Link == r.Text || r.Link == "mailto:"+r.Text) && !strings.ContainsAny(r.Text, " <>"):
			text = "<" + r.Text + ">"
		default:
			text = "[" + text + "](" + mdURL(r.Link) + ")"
		}
		b.WriteString(strings.ReplaceAll(text, "\n", "  \n"))
	}
	return b.String()
}

func mdURL(u string) string {
	if strings.ContainsAny(u, " ()") {
		return "<" + u + ">"
	}
	return u
}

func writeMarkdown(dst string, d *Doc) error {
	var b strings.Builder
	assets := ""
	pics := 0
	prev := -1
	for i, blk := range d.Blocks {
		// Blank lines between blocks, none between items of one list.
		sameList := blk.Kind == ListItem && BlockKind(prev) == ListItem && !(blk.Level == 0 && blk.Ordered != d.Blocks[i-1].Ordered)
		if i > 0 && !sameList && !(blk.Kind == Quote && BlockKind(prev) == Quote) {
			b.WriteString("\n")
		}
		if blk.Kind == Quote && BlockKind(prev) == Quote {
			b.WriteString(">\n")
		}
		prev = int(blk.Kind)
		switch blk.Kind {
		case Heading:
			b.WriteString(strings.Repeat("#", min(max(blk.Level, 1), 6)) + " " + strings.ReplaceAll(mdRuns(blk.Runs), "  \n", " ") + "\n")
		case Para:
			b.WriteString(mdRuns(blk.Runs) + "\n")
		case Quote:
			for _, l := range strings.Split(mdRuns(blk.Runs), "\n") {
				b.WriteString("> " + l + "\n")
			}
		case ListItem:
			ind := strings.Repeat("   ", blk.Level)
			marker := "- "
			if blk.Ordered {
				marker = strconv.Itoa(max(blk.Number, 1)) + ". "
			}
			text := strings.ReplaceAll(mdRuns(blk.Runs), "  \n", "  \n"+ind+strings.Repeat(" ", len(marker)))
			b.WriteString(ind + marker + text + "\n")
		case Code:
			fence := "```"
			for strings.Contains(blk.Text, fence) {
				fence += "`"
			}
			b.WriteString(fence + "\n" + blk.Text + "\n" + fence + "\n")
		case Rule:
			b.WriteString("---\n")
		case Table:
			mdTable(&b, blk.Rows)
		case Picture:
			ref := blk.Text
			if p := d.picturePath(blk.Text); p != "" && d.tmp != "" && strings.HasPrefix(p, d.tmp) {
				// A picture from inside a Word/OpenDocument file goes next to
				// the Markdown, in a folder named after it.
				if assets == "" {
					assets = stemOf(dst) + " files"
					if err := os.MkdirAll(filepath.Join(filepath.Dir(dst), assets), 0o755); err != nil {
						return err
					}
				}
				pics++
				name := fmt.Sprintf("picture %d%s", pics, filepath.Ext(p))
				data, err := os.ReadFile(p)
				if err != nil {
					return err
				}
				if err := fs.AtomicWriteReader(filepath.Join(filepath.Dir(dst), assets, name), bytes.NewReader(data)); err != nil {
					return err
				}
				ref = assets + "/" + name
			}
			b.WriteString("![" + mdEscape(blk.Alt, false) + "](" + mdURL(strings.ReplaceAll(ref, `\`, "/")) + ")\n")
		}
	}
	return fs.AtomicWriteReader(dst, strings.NewReader(b.String()))
}

func mdTable(b *strings.Builder, rows [][][]Inline) {
	cols := 0
	for _, r := range rows {
		cols = max(cols, len(r))
	}
	if cols == 0 {
		return
	}
	line := func(r [][]Inline) {
		b.WriteString("|")
		for c := range cols {
			cell := ""
			if c < len(r) {
				cell = strings.ReplaceAll(strings.ReplaceAll(mdRuns(r[c]), "  \n", "<br>"), "|", `\|`)
			}
			b.WriteString(" " + cell + " |")
		}
		b.WriteString("\n")
	}
	head := make([][]Inline, len(rows[0]))
	for c, cell := range rows[0] {
		head[c] = append([]Inline(nil), cell...)
		for k := range head[c] {
			head[c][k].Bold = false // a header is bold anyway
		}
		head[c] = merge(head[c])
	}
	line(head)
	b.WriteString("|" + strings.Repeat(" --- |", cols) + "\n")
	for _, r := range rows[1:] {
		line(r)
	}
}

// ---------- plain text ----------

func writePlain(dst string, d *Doc) error {
	var b strings.Builder
	for i, blk := range d.Blocks {
		if i > 0 && !(blk.Kind == ListItem && d.Blocks[i-1].Kind == ListItem) {
			b.WriteString("\n")
		}
		text := runsText(blk.Runs)
		switch blk.Kind {
		case Heading:
			b.WriteString(text + "\n")
			if blk.Level <= 2 {
				ch := "="
				if blk.Level == 2 {
					ch = "-"
				}
				b.WriteString(strings.Repeat(ch, max(3, len([]rune(text)))) + "\n")
			}
		case Para:
			b.WriteString(text + "\n")
		case Quote:
			for _, l := range strings.Split(text, "\n") {
				b.WriteString("    " + l + "\n")
			}
		case ListItem:
			ind := strings.Repeat("  ", blk.Level)
			marker := "• "
			if blk.Ordered {
				marker = strconv.Itoa(max(blk.Number, 1)) + ". "
			}
			b.WriteString(ind + marker + strings.ReplaceAll(text, "\n", "\n"+ind+strings.Repeat(" ", len([]rune(marker)))) + "\n")
		case Code:
			for _, l := range strings.Split(blk.Text, "\n") {
				b.WriteString("    " + l + "\n")
			}
		case Rule:
			b.WriteString(strings.Repeat("─", 24) + "\n")
		case Table:
			for _, r := range blk.Rows {
				cells := make([]string, len(r))
				for c, cell := range r {
					cells[c] = strings.ReplaceAll(runsText(cell), "\n", " ")
				}
				b.WriteString(strings.Join(cells, "\t") + "\n")
			}
		case Picture:
			if blk.Alt != "" {
				b.WriteString("[" + blk.Alt + "]\n")
			}
		}
	}
	return fs.AtomicWriteReader(dst, strings.NewReader(b.String()))
}

// ---------- HTML ----------

// The page's look: the Markdown preview's, light and dark, for reading in a
// browser and for printing.
const htmlStyle = `
:root { color-scheme: light dark; --fg: #1d1d1f; --muted: #6e6e73; --line: #d9d9de; --soft: #f4f4f6; --link: #0b62d6; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8e8ed; --muted: #a1a1a6; --line: #3a3a3e; --soft: #232326; --link: #6aa8ff; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 48px 20px 80px; color: var(--fg); background: Canvas; font: 16px/1.7 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 760px; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 { font-family: "Source Serif 4", Georgia, "Times New Roman", serif; font-weight: 600; line-height: 1.25; margin: 1.6em 0 0.5em; }
h1 { font-size: 2em; margin-top: 0; } h2 { font-size: 1.5em; } h3 { font-size: 1.22em; } h4 { font-size: 1.05em; }
p, ul, ol, blockquote, pre, table, figure { margin: 0 0 1em; }
a { color: var(--link); }
code, pre { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; }
code { background: var(--soft); padding: 0.1em 0.35em; border-radius: 4px; }
pre { background: var(--soft); padding: 12px 14px; border-radius: 8px; overflow-x: auto; line-height: 1.5; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid var(--line); padding-left: 14px; color: var(--muted); }
blockquote + blockquote { margin-top: -0.5em; }
hr { border: none; border-top: 1px solid var(--line); margin: 2em 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.94em; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--soft); }
img { max-width: 100%; height: auto; }
figure { text-align: center; }
@media print { body { padding: 0; background: none; } a { color: inherit; } }
`

func htmlRuns(w *bytes.Buffer, runs []Inline) {
	for _, r := range runs {
		if r.Text == "\n" {
			w.WriteString("<br>")
			continue
		}
		open, close := "", ""
		wrap := func(tag string) {
			open += "<" + tag + ">"
			close = "</" + tag + ">" + close
		}
		if r.Link != "" {
			open += `<a href="` + html.EscapeString(r.Link) + `">`
			close = "</a>" + close
		}
		if r.Bold {
			wrap("strong")
		}
		if r.Italic {
			wrap("em")
		}
		if r.Strike {
			wrap("s")
		}
		if r.Code {
			wrap("code")
		}
		w.WriteString(open + strings.ReplaceAll(html.EscapeString(r.Text), "\n", "<br>") + close)
	}
}

func writeHTML(dst string, d *Doc) error {
	var w bytes.Buffer
	w.WriteString("<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"generator\" content=\"Monoform\">\n<title>")
	w.WriteString(html.EscapeString(d.Title))
	w.WriteString("</title>\n<style>" + htmlStyle + "</style>\n</head>\n<body>\n<main>\n")
	var lists []bool // open lists: numbered?
	closeLists := func(depth int) {
		for len(lists) > depth {
			if lists[len(lists)-1] {
				w.WriteString("</li></ol>\n")
			} else {
				w.WriteString("</li></ul>\n")
			}
			lists = lists[:len(lists)-1]
		}
	}
	for _, blk := range d.Blocks {
		if blk.Kind != ListItem {
			closeLists(0)
		}
		switch blk.Kind {
		case Heading:
			l := min(max(blk.Level, 1), 6)
			fmt.Fprintf(&w, "<h%d>", l)
			htmlRuns(&w, blk.Runs)
			fmt.Fprintf(&w, "</h%d>\n", l)
		case Para:
			w.WriteString("<p>")
			htmlRuns(&w, blk.Runs)
			w.WriteString("</p>\n")
		case Quote:
			w.WriteString("<blockquote><p>")
			htmlRuns(&w, blk.Runs)
			w.WriteString("</p></blockquote>\n")
		case ListItem:
			depth := blk.Level + 1
			if depth < len(lists) {
				closeLists(depth)
			}
			open := func() {
				switch {
				case !blk.Ordered:
					w.WriteString("<ul>\n")
				case blk.Number > 1:
					fmt.Fprintf(&w, "<ol start=\"%d\">\n", blk.Number)
				default:
					w.WriteString("<ol>\n")
				}
				lists = append(lists, blk.Ordered)
			}
			switch {
			case depth > len(lists):
				for len(lists) < depth {
					open()
				}
			case lists[len(lists)-1] != blk.Ordered:
				closeLists(depth - 1)
				open()
			default:
				w.WriteString("</li>\n")
			}
			w.WriteString("<li>")
			htmlRuns(&w, blk.Runs)
		case Code:
			w.WriteString("<pre><code>" + html.EscapeString(blk.Text) + "</code></pre>\n")
		case Rule:
			w.WriteString("<hr>\n")
		case Table:
			w.WriteString("<table>\n")
			for i, r := range blk.Rows {
				tag := "td"
				if i == 0 && len(blk.Rows) > 1 {
					tag = "th"
				}
				w.WriteString("<tr>")
				for _, c := range r {
					w.WriteString("<" + tag + ">")
					htmlRuns(&w, c)
					w.WriteString("</" + tag + ">")
				}
				w.WriteString("</tr>\n")
			}
			w.WriteString("</table>\n")
		case Picture:
			src := ""
			if p := d.picturePath(blk.Text); p != "" {
				// The page carries its pictures, so it can be sent on its own.
				if data, ext, _, err := pictureData(p); err == nil {
					mime := map[string]string{"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif"}[ext]
					src = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
				}
			} else if strings.HasPrefix(blk.Text, "https://") || strings.HasPrefix(blk.Text, "http://") {
				src = blk.Text
			}
			if src != "" {
				w.WriteString(`<figure><img src="` + html.EscapeString(src) + `" alt="` + html.EscapeString(blk.Alt) + `"></figure>` + "\n")
			}
		}
	}
	closeLists(0)
	w.WriteString("</main>\n</body>\n</html>\n")
	return fs.AtomicWriteReader(dst, io.Reader(&w))
}
