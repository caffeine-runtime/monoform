package office

// Text extraction from legacy Word 97–2003 (.doc) files: the main document
// text is assembled from the piece table in the CLX structure. Formatting,
// images and tables are not read (the editor says so and saves as .docx).

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"strings"
	"unicode/utf16"

	"github.com/richardlehane/mscfb"
	"golang.org/x/text/encoding/charmap"
)

var ErrEncryptedDoc = errors.New("this .doc file is password-protected")

// ReadDoc returns the paragraphs of a .doc file's main text.
func ReadDoc(p string) (paras []string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("could not read this .doc file: %v", r)
		}
	}()
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	doc, err := mscfb.New(f)
	if err != nil {
		return nil, fmt.Errorf("not a Word 97–2003 document: %w", err)
	}
	streams := map[string][]byte{}
	for e, err := doc.Next(); err == nil; e, err = doc.Next() {
		switch e.Name {
		case "WordDocument", "0Table", "1Table":
			buf := make([]byte, e.Size)
			if _, err := e.Read(buf); err != nil && int64(len(buf)) != e.Size {
				return nil, err
			}
			streams[e.Name] = buf
		}
	}
	wd := streams["WordDocument"]
	if len(wd) < 0x22 || binary.LittleEndian.Uint16(wd) != 0xA5EC {
		return nil, errors.New("not a Word 97–2003 document")
	}
	flags := binary.LittleEndian.Uint16(wd[0x0A:])
	if flags&0x0100 != 0 {
		return nil, ErrEncryptedDoc
	}
	table := streams["0Table"]
	if flags&0x0200 != 0 {
		table = streams["1Table"]
	}
	// FibBase (32 bytes) | csw | fibRgW | cslw | fibRgLw | cbRgFcLcb | fibRgFcLcbBlob
	pos := 32
	csw := int(binary.LittleEndian.Uint16(wd[pos:]))
	pos += 2 + csw*2
	cslw := int(binary.LittleEndian.Uint16(wd[pos:]))
	rgLw := pos + 2
	ccpText := int(binary.LittleEndian.Uint32(wd[rgLw+3*4:]))
	pos = rgLw + cslw*4
	pos += 2 // cbRgFcLcb
	fcClx := int(binary.LittleEndian.Uint32(wd[pos+33*8:]))
	lcbClx := int(binary.LittleEndian.Uint32(wd[pos+33*8+4:]))
	if fcClx+lcbClx > len(table) || lcbClx == 0 {
		return nil, errors.New("piece table not found")
	}
	clx := table[fcClx : fcClx+lcbClx]
	// Skip Prc entries, then read the Pcdt.
	i := 0
	for i < len(clx) && clx[i] == 0x01 {
		n := int(int16(binary.LittleEndian.Uint16(clx[i+1:])))
		i += 3 + n
	}
	if i >= len(clx) || clx[i] != 0x02 {
		return nil, errors.New("piece table not found")
	}
	lcb := int(binary.LittleEndian.Uint32(clx[i+1:]))
	plc := clx[i+5 : i+5+lcb]
	n := (lcb - 4) / 12
	cps := make([]int, n+1)
	for k := 0; k <= n; k++ {
		cps[k] = int(binary.LittleEndian.Uint32(plc[k*4:]))
	}
	var text strings.Builder
	got := 0
	for k := 0; k < n && got < ccpText; k++ {
		pcd := plc[(n+1)*4+k*8:]
		fc := binary.LittleEndian.Uint32(pcd[2:])
		count := cps[k+1] - cps[k]
		if got+count > ccpText {
			count = ccpText - got
		}
		if fc&0x40000000 != 0 {
			start := int(fc&0x3FFFFFFF) / 2
			b := wd[start : start+count]
			s, _ := charmap.Windows1252.NewDecoder().Bytes(b)
			text.Write(s)
		} else {
			start := int(fc)
			u := make([]uint16, count)
			for j := range u {
				u[j] = binary.LittleEndian.Uint16(wd[start+2*j:])
			}
			text.WriteString(string(utf16.Decode(u)))
		}
		got += count
	}
	return splitWordText(text.String()), nil
}

// splitWordText turns Word's control characters into paragraphs.
func splitWordText(s string) []string {
	var out []string
	var cur bytes.Buffer
	depth := 0 // field nesting; field codes (between 0x13 and 0x14) are dropped
	inCode := []bool{}
	flush := func() {
		out = append(out, strings.TrimRight(cur.String(), " "))
		cur.Reset()
	}
	for _, r := range s {
		switch r {
		case 0x13:
			depth++
			inCode = append(inCode, true)
			continue
		case 0x14:
			if depth > 0 {
				inCode[depth-1] = false
			}
			continue
		case 0x15:
			if depth > 0 {
				depth--
				inCode = inCode[:depth]
			}
			continue
		}
		if depth > 0 && inCode[depth-1] {
			continue
		}
		switch r {
		case '\r', 0x0C:
			flush()
		case 0x07: // table cell / row end
			cur.WriteByte('\t')
		case 0x0B:
			cur.WriteByte(' ')
		case 0x1E:
			cur.WriteByte('-')
		case 0x01, 0x08, 0x1F:
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		flush()
	}
	// Tables leave trailing tabs; drop them and trailing empty paragraphs.
	for i := range out {
		out[i] = strings.TrimRight(out[i], "\t")
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out
}
