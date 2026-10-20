package archive

// Packages and disk images the archives library doesn't read: Debian
// packages (an ar archive with control.tar.* and data.tar.*), RPM (headers +
// a compressed cpio payload) and ISO 9660 disc images (with Joliet and Rock
// Ridge long names). Each walker calls fn once per entry with a reader that
// is valid during the call, like archives.Extractor.

import (
	"archive/tar"
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	iofs "io/fs"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/mholt/archives"
)

type walkFn func(info archives.FileInfo, name string) error

// entryInfo implements fs.FileInfo for our own formats.
type entryInfo struct {
	name string
	size int64
	mode iofs.FileMode
	mod  time.Time
}

func (e entryInfo) Name() string        { return path.Base(e.name) }
func (e entryInfo) Size() int64         { return e.size }
func (e entryInfo) Mode() iofs.FileMode { return e.mode }
func (e entryInfo) ModTime() time.Time  { return e.mod }
func (e entryInfo) IsDir() bool         { return e.mode.IsDir() }
func (e entryInfo) Sys() any            { return nil }

type readerFile struct {
	io.Reader
	info iofs.FileInfo
}

func (r readerFile) Stat() (iofs.FileInfo, error) { return r.info, nil }
func (r readerFile) Read(b []byte) (int, error)   { return r.Reader.Read(b) }
func (r readerFile) Close() error                 { return nil }

func fileEntry(name string, size int64, mode iofs.FileMode, mod time.Time, link string, open func() io.Reader) archives.FileInfo {
	info := entryInfo{name: name, size: size, mode: mode, mod: mod}
	return archives.FileInfo{
		FileInfo:      info,
		NameInArchive: name,
		LinkTarget:    link,
		Open: func() (iofs.File, error) {
			if open == nil {
				return nil, errors.New("not a file")
			}
			return readerFile{open(), info}, nil
		},
	}
}

func archivesInfo(info entryInfo, open func() (iofs.File, error)) archives.FileInfo {
	return archives.FileInfo{FileInfo: info, NameInArchive: info.name, Open: open}
}

// customKind recognises our own formats by their magic numbers.
func customKind(f *os.File) string {
	head := make([]byte, 8)
	if n, _ := f.ReadAt(head, 0); n >= 8 {
		if string(head) == "!<arch>\n" {
			return "deb"
		}
		if bytes.Equal(head[:4], []byte{0xED, 0xAB, 0xEE, 0xDB}) {
			return "rpm"
		}
	}
	// .doc/.xls share the compound-file magic, so MSI also needs its extension.
	if bytes.Equal(head, []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}) && strings.HasSuffix(strings.ToLower(f.Name()), ".msi") {
		return "msi"
	}
	iso := make([]byte, 5)
	if n, _ := f.ReadAt(iso, 32769); n == 5 && string(iso) == "CD001" {
		return "iso"
	}
	return ""
}

func walkCustom(ctx context.Context, kind string, f *os.File, fn walkFn) (map[string]string, error) {
	switch kind {
	case "deb":
		return walkDeb(ctx, f, fn)
	case "rpm":
		return walkRPM(ctx, f, fn)
	case "iso":
		return walkISO(ctx, f, fn)
	case "msi":
		return walkMSI(ctx, f, fn)
	}
	return nil, ErrNotArchive
}

// decompress opens a (possibly) compressed stream, identified by its content.
func decompress(ctx context.Context, name string, r io.Reader) (io.Reader, func(), error) {
	br := bufio.NewReaderSize(r, 1<<16)
	format, stream, err := archives.Identify(ctx, name, br)
	if err != nil {
		if errors.Is(err, archives.NoMatch) {
			return stream, func() {}, nil // uncompressed
		}
		return nil, nil, err
	}
	if d, ok := format.(archives.Decompressor); ok {
		rc, err := d.OpenReader(stream)
		if err != nil {
			return nil, nil, err
		}
		return rc, func() { rc.Close() }, nil
	}
	return stream, func() {}, nil
}

// ---------- .deb ----------

func walkDeb(ctx context.Context, f *os.File, fn walkFn) (map[string]string, error) {
	meta := map[string]string{"Type": "Debian package"}
	st, _ := f.Stat()
	off := int64(8)
	for off+60 <= st.Size() {
		h := make([]byte, 60)
		if _, err := f.ReadAt(h, off); err != nil {
			return meta, err
		}
		name := strings.TrimRight(strings.TrimSpace(string(h[:16])), "/")
		size, err := strconv.ParseInt(strings.TrimSpace(string(h[48:58])), 10, 64)
		if err != nil || size < 0 {
			return meta, errors.New("corrupt .deb (ar header)")
		}
		mod, _ := strconv.ParseInt(strings.TrimSpace(string(h[16:28])), 10, 64)
		body := io.NewSectionReader(f, off+60, size)
		off += 60 + size + size&1
		switch {
		case name == "debian-binary":
			if err := fn(fileEntry(name, size, 0o644, time.Unix(mod, 0), "", func() io.Reader { return io.NewSectionReader(body, 0, size) }), name); err != nil {
				return meta, err
			}
		case strings.HasPrefix(name, "control.tar") || strings.HasPrefix(name, "data.tar"):
			prefix := strings.SplitN(name, ".", 2)[0]
			r, done, err := decompress(ctx, name, body)
			if err != nil {
				return meta, fmt.Errorf("%s: %w", name, err)
			}
			err = walkTar(ctx, tar.NewReader(r), prefix, func(info archives.FileInfo, n string) error {
				if prefix == "control" && n == "control/control" && info.Size() < 1<<20 {
					rf, _ := info.Open()
					b, _ := io.ReadAll(rf)
					debControl(b, meta)
					info.Open = func() (iofs.File, error) { return readerFile{bytes.NewReader(b), info.FileInfo}, nil }
				}
				return fn(info, n)
			})
			done()
			if err != nil {
				return meta, err
			}
		}
	}
	return meta, nil
}

func walkTar(ctx context.Context, tr *tar.Reader, prefix string, fn walkFn) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := cleanName(h.Name)
		if name == "" || name == "." {
			continue
		}
		full := prefix + "/" + name
		info := fileEntry(full, h.Size, h.FileInfo().Mode(), h.ModTime, h.Linkname, func() io.Reader { return tr })
		if err := fn(info, full); err != nil {
			return err
		}
	}
}

func debControl(b []byte, meta map[string]string) {
	var key string
	for _, line := range strings.Split(string(b), "\n") {
		if line == "" {
			continue
		}
		if line[0] == ' ' || line[0] == '\t' {
			continue // continuation (long description)
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(k)
		switch key {
		case "Package", "Version", "Architecture", "Maintainer", "Depends", "Section", "Homepage", "Installed-Size":
			meta[key] = strings.TrimSpace(v)
		case "Description":
			meta["Summary"] = strings.TrimSpace(v)
		}
	}
}

// ---------- .rpm ----------

func walkRPM(ctx context.Context, f *os.File, fn walkFn) (map[string]string, error) {
	meta := map[string]string{"Type": "RPM package"}
	off := int64(96)
	readHeader := func(off int64) (int64, map[int32]string, error) {
		h := make([]byte, 16)
		if _, err := f.ReadAt(h, off); err != nil {
			return 0, nil, err
		}
		if !bytes.Equal(h[:3], []byte{0x8E, 0xAD, 0xE8}) {
			return 0, nil, errors.New("corrupt RPM header")
		}
		n := int64(binary.BigEndian.Uint32(h[8:]))
		size := int64(binary.BigEndian.Uint32(h[12:]))
		if n > 1<<16 || size > 64<<20 {
			return 0, nil, errors.New("corrupt RPM header (too large)")
		}
		idx := make([]byte, n*16)
		data := make([]byte, size)
		if _, err := f.ReadAt(idx, off+16); err != nil {
			return 0, nil, err
		}
		if _, err := f.ReadAt(data, off+16+n*16); err != nil {
			return 0, nil, err
		}
		tags := map[int32]string{}
		for i := int64(0); i < n; i++ {
			e := idx[i*16:]
			tag := int32(binary.BigEndian.Uint32(e))
			typ := binary.BigEndian.Uint32(e[4:])
			o := int64(binary.BigEndian.Uint32(e[8:]))
			if o >= size {
				continue
			}
			if typ == 6 || typ == 9 || typ == 8 { // string, i18n string, string array: first string
				end := bytes.IndexByte(data[o:], 0)
				if end >= 0 {
					tags[tag] = string(data[o : o+int64(end)])
				}
			}
		}
		return 16 + n*16 + size, tags, nil
	}
	n, _, err := readHeader(off)
	if err != nil {
		return meta, err
	}
	off += n
	off = (off + 7) &^ 7 // the signature header is padded to 8 bytes
	n, tags, err := readHeader(off)
	if err != nil {
		return meta, err
	}
	off += n
	for tag, key := range map[int32]string{1000: "Package", 1001: "Version", 1002: "Release", 1004: "Summary", 1014: "License", 1022: "Architecture", 1020: "Homepage", 1125: "Payload"} {
		if v := tags[tag]; v != "" {
			meta[key] = v
		}
	}
	st, _ := f.Stat()
	r, done, err := decompress(ctx, "payload", io.NewSectionReader(f, off, st.Size()-off))
	if err != nil {
		return meta, err
	}
	defer done()
	return meta, walkCPIO(ctx, bufio.NewReaderSize(r, 1<<16), fn)
}

// walkCPIO reads the "newc" (070701/070702) cpio format.
func walkCPIO(ctx context.Context, r *bufio.Reader, fn walkFn) error {
	var pos int64
	read := func(b []byte) error {
		n, err := io.ReadFull(r, b)
		pos += int64(n)
		return err
	}
	skip := func(n int64) error {
		k, err := io.CopyN(io.Discard, r, n)
		pos += k
		return err
	}
	pad := func() error { return skip((4 - pos%4) % 4) }
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		h := make([]byte, 110)
		if err := read(h); err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("cpio: %w", err)
		}
		magic := string(h[:6])
		if magic != "070701" && magic != "070702" {
			return errors.New("cpio: unsupported format " + magic)
		}
		field := func(i int) int64 {
			v, _ := strconv.ParseInt(string(h[6+i*8:14+i*8]), 16, 64)
			return v
		}
		mode := field(1)
		mtime := field(5)
		size := field(6)
		nameSize := field(11)
		nb := make([]byte, nameSize)
		if err := read(nb); err != nil {
			return err
		}
		if err := pad(); err != nil {
			return err
		}
		name := cleanName(strings.TrimRight(string(nb), "\x00"))
		if name == "TRAILER!!!" {
			return nil
		}
		var fm iofs.FileMode = iofs.FileMode(mode & 0o777)
		link := ""
		switch mode & 0o170000 {
		case 0o040000:
			fm |= iofs.ModeDir
		case 0o120000:
			fm |= iofs.ModeSymlink
			lb := make([]byte, size)
			if err := read(lb); err != nil {
				return err
			}
			link = string(lb)
			size = 0
		}
		lr := io.LimitReader(r, size)
		counted := &countReader{r: lr, n: &pos}
		if name != "" && name != "." {
			if err := fn(fileEntry(name, size, fm, time.Unix(mtime, 0), link, func() io.Reader { return counted }), name); err != nil {
				return err
			}
		}
		// Skip whatever the callback didn't read.
		if _, err := io.Copy(io.Discard, counted); err != nil {
			return err
		}
		if err := pad(); err != nil {
			return err
		}
	}
}

type countReader struct {
	r io.Reader
	n *int64
}

func (c *countReader) Read(b []byte) (int, error) {
	k, err := c.r.Read(b)
	*c.n += int64(k)
	return k, err
}

// ---------- ISO 9660 ----------

const sector = 2048

type isoDir struct {
	lba, size int64
	path      string
}

func walkISO(ctx context.Context, f *os.File, fn walkFn) (map[string]string, error) {
	meta := map[string]string{"Type": "ISO 9660 disc image"}
	var root, joliet []byte
	udf := false
	for s := int64(16); s < 64; s++ {
		d := make([]byte, sector)
		if _, err := f.ReadAt(d, s*sector); err != nil {
			break
		}
		id := string(d[1:6])
		if id == "NSR02" || id == "NSR03" {
			udf = true
		}
		if id != "CD001" {
			continue
		}
		switch d[0] {
		case 1:
			root = append([]byte(nil), d[156:156+34]...)
			meta["Volume"] = strings.TrimSpace(string(d[40:72]))
			if v := strings.TrimSpace(string(d[318:446])); v != "" {
				meta["Publisher"] = v
			}
		case 2:
			if esc := string(d[88:91]); esc == "%/@" || esc == "%/C" || esc == "%/E" {
				joliet = append([]byte(nil), d[156:156+34]...)
				if v := ucs2(d[40:72]); strings.TrimSpace(v) != "" {
					meta["Volume"] = strings.TrimSpace(v)
				}
			}
		case 255:
			s = 64
		}
	}
	// UDF signatures can also sit after the ISO descriptors (sectors 16+).
	if root == nil {
		return meta, errors.New("no ISO 9660 volume descriptor")
	}
	rec, useJoliet := root, false
	if joliet != nil {
		rec, useJoliet = joliet, true
	}
	if useJoliet {
		meta["Names"] = "Joliet"
	}
	start := isoDir{lba: int64(binary.LittleEndian.Uint32(rec[2:])), size: int64(binary.LittleEndian.Uint32(rec[10:]))}
	visited := map[int64]bool{}
	count := 0
	rockRidge := false
	var walkDir func(d isoDir, depth int) error
	walkDir = func(d isoDir, depth int) error {
		if depth > 64 || visited[d.lba] || d.size > 64<<20 {
			return nil
		}
		visited[d.lba] = true
		buf := make([]byte, d.size)
		if _, err := f.ReadAt(buf, d.lba*sector); err != nil {
			return err
		}
		for p := 0; p < len(buf); {
			if err := ctx.Err(); err != nil {
				return err
			}
			l := int(buf[p])
			if l == 0 {
				p = (p/sector + 1) * sector
				continue
			}
			if p+l > len(buf) || l < 34 {
				break
			}
			r := buf[p : p+l]
			p += l
			nl := int(r[32])
			if 33+nl > len(r) {
				continue
			}
			raw := r[33 : 33+nl]
			if nl == 1 && (raw[0] == 0 || raw[0] == 1) {
				continue // . and ..
			}
			var name string
			if useJoliet {
				name = ucs2(raw)
			} else {
				name = string(raw)
			}
			if i := strings.LastIndex(name, ";"); i > 0 {
				name = name[:i]
			}
			name = strings.TrimSuffix(name, ".")
			if !useJoliet {
				su := 33 + nl
				if nl%2 == 0 {
					su++
				}
				if su < len(r) {
					if nm := rrName(r[su:]); nm != "" {
						name = nm
						rockRidge = true
					}
				}
			}
			if name == "" || strings.ContainsAny(name, "/\x00") {
				continue
			}
			full := name
			if d.path != "" {
				full = d.path + "/" + name
			}
			lba := int64(binary.LittleEndian.Uint32(r[2:]))
			size := int64(binary.LittleEndian.Uint32(r[10:]))
			mod := isoTime(r[18:25])
			if r[25]&0x02 != 0 {
				if err := fn(fileEntry(full, 0, iofs.ModeDir|0o755, mod, "", nil), full); err != nil {
					return err
				}
				if err := walkDir(isoDir{lba: lba, size: size, path: full}, depth+1); err != nil {
					return err
				}
				continue
			}
			count++
			sr := io.NewSectionReader(f, lba*sector, size)
			if err := fn(fileEntry(full, size, 0o644, mod, "", func() io.Reader { return sr }), full); err != nil {
				return err
			}
		}
		return nil
	}
	err := walkDir(start, 0)
	if rockRidge {
		meta["Names"] = "Rock Ridge"
	}
	if udf && count <= 3 {
		meta["Note"] = "This disc keeps its files in a UDF file system (common for Windows and Blu-ray images), which can't be browsed here yet; only the small ISO 9660 part is shown."
	}
	return meta, err
}

func ucs2(b []byte) string {
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = binary.BigEndian.Uint16(b[i*2:])
	}
	return strings.TrimRight(string(utf16.Decode(u)), "\x00 ")
}

// rrName returns the Rock Ridge alternate name (NM entries) from a system use area.
func rrName(su []byte) string {
	var name strings.Builder
	for p := 0; p+4 <= len(su); {
		sig := string(su[p : p+2])
		l := int(su[p+2])
		if l < 4 || p+l > len(su) {
			break
		}
		if sig == "NM" && l >= 5 {
			flags := su[p+4]
			if flags&0x06 == 0 { // not "." / ".."
				name.Write(su[p+5 : p+l])
			}
		}
		if sig == "ST" {
			break
		}
		p += l
	}
	return name.String()
}

func isoTime(b []byte) time.Time {
	if len(b) < 7 || b[0] == 0 {
		return time.Time{}
	}
	t := time.Date(1900+int(b[0]), time.Month(b[1]), int(b[2]), int(b[3]), int(b[4]), int(b[5]), 0, time.UTC)
	return t.Add(-time.Duration(int8(b[6])) * 15 * time.Minute)
}
