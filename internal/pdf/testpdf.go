package pdf

import (
	"bytes"
	"fmt"
)

// Minimal returns a valid PDF with n pages; page i shows the text "Page i".
// Used by tests and fixtures.
func Minimal(n int) []byte {
	var b bytes.Buffer
	offsets := []int{}
	obj := func(s string) {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", len(offsets), s)
	}
	b.WriteString("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
	// 1: catalog, 2: pages, 3: font, then per page: page + content
	kids := ""
	for i := 0; i < n; i++ {
		kids += fmt.Sprintf("%d 0 R ", 4+i*2)
	}
	obj("<< /Type /Catalog /Pages 2 0 R >>")
	obj(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", kids, n))
	obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	for i := 0; i < n; i++ {
		obj(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", 5+i*2))
		content := fmt.Sprintf("BT /F1 36 Tf 72 700 Td (Page %d) Tj ET", i+1)
		obj(fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content))
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, o := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)
	return b.Bytes()
}
