package semantic

import (
	"strings"
	"unicode/utf8"
)

// Passage is a piece of a file that gets one embedding.
type Passage struct {
	Line int    `json:"line"` // 1-based line where the passage starts
	Text string `json:"text"`
}

// PassageChars is the target passage length (~200 tokens of English prose).
// Inference cost grows with the number of tokens, so passages are kept short
// and the number per file is capped.
const PassageChars = 900

// MaxPassages is how many passages of one file are indexed.
const MaxPassages = 8

// Passages splits text into passages of about PassageChars characters,
// preferring blank-line (paragraph) boundaries, then line boundaries. At most
// max passages are returned; whitespace-only passages are dropped.
func Passages(text string, max int) []Passage {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	var out []Passage
	var cur strings.Builder
	start := 0
	flush := func() bool {
		t := strings.TrimSpace(cur.String())
		cur.Reset()
		if t != "" {
			out = append(out, Passage{Line: start + 1, Text: t})
		}
		return len(out) >= max
	}
	for i, ln := range lines {
		if len(ln) > PassageChars {
			// A very long line (minified code, a paragraph without breaks):
			// cut it on rune boundaries.
			if cur.Len() > 0 && flush() {
				return out
			}
			for len(ln) > 0 {
				cut := min(PassageChars, len(ln))
				for cut < len(ln) && !utf8.RuneStart(ln[cut]) {
					cut--
				}
				start = i
				cur.WriteString(ln[:cut])
				ln = ln[cut:]
				if flush() {
					return out
				}
			}
			start = i + 1
			continue
		}
		blank := strings.TrimSpace(ln) == ""
		// Break at a paragraph boundary once the passage is half full, or
		// anywhere when the next line would overflow it.
		if cur.Len() > 0 && ((blank && cur.Len() >= PassageChars/2) || cur.Len()+len(ln) > PassageChars) {
			if flush() {
				return out
			}
		}
		if cur.Len() == 0 {
			if blank {
				continue
			}
			start = i
		}
		cur.WriteString(ln)
		cur.WriteByte('\n')
	}
	flush()
	return out
}

// Snippet shortens a passage for display.
func Snippet(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}
	cut := n
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}
