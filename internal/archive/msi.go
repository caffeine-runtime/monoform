package archive

// Windows Installer packages (.msi): an OLE compound file holding database
// tables. The File, Component and Directory tables give each file's install
// path and size; the Media table says which cabinet (CAB) holds it. Files in
// embedded cabinets can be extracted when the cabinet is stored or MSZIP
// (deflate) compressed; LZX/Quantum cabinets are listed only.

import (
	"bytes"
	"compress/flate"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	iofs "io/fs"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/richardlehane/mscfb"
	"golang.org/x/text/encoding/charmap"
)

// msiName decodes the compressed stream names MSI uses (two base-64 characters per UTF-16 unit).
func msiName(s string) (string, bool) {
	var b strings.Builder
	table := false
	mime := func(x rune) byte {
		switch {
		case x < 10:
			return byte('0' + x)
		case x < 36:
			return byte('A' + x - 10)
		case x < 62:
			return byte('a' + x - 36)
		case x == 62:
			return '.'
		}
		return '_'
	}
	for _, c := range s {
		switch {
		case c == 0x4840:
			table = true
		case c >= 0x3800 && c < 0x4800:
			c -= 0x3800
			b.WriteByte(mime(c & 0x3f))
			b.WriteByte(mime((c >> 6) & 0x3f))
		case c >= 0x4800 && c < 0x4840:
			b.WriteByte(mime(c - 0x4800))
		default:
			b.WriteRune(c)
		}
	}
	return b.String(), table
}

type msiDB struct {
	streams map[string]*mscfb.File // decoded name → stream ("!" prefix for tables)
	strs    []string
	wide    bool // string references are 3 bytes
}

func (db *msiDB) read(name string) ([]byte, error) {
	f, ok := db.streams[name]
	if !ok {
		return nil, fmt.Errorf("missing %s", name)
	}
	b := make([]byte, f.Size)
	_, err := f.ReadAt(b, 0)
	if err == io.EOF {
		err = nil
	}
	return b, err
}

func (db *msiDB) loadStrings() error {
	pool, err := db.read("!_StringPool")
	if err != nil {
		return err
	}
	data, err := db.read("!_StringData")
	if err != nil {
		return err
	}
	if len(pool) < 4 {
		return errors.New("empty string pool")
	}
	cp := int(binary.LittleEndian.Uint16(pool)) | int(binary.LittleEndian.Uint16(pool[2:])&0x7fff)<<16
	db.wide = binary.LittleEndian.Uint16(pool[2:])&0x8000 != 0
	var dec func([]byte) string
	switch cp {
	case 0, 65001, 1252:
		if cp == 65001 {
			dec = func(b []byte) string { return string(b) }
		} else {
			dec = func(b []byte) string { s, _ := charmap.Windows1252.NewDecoder().Bytes(b); return string(s) }
		}
	case 1250:
		dec = func(b []byte) string { s, _ := charmap.Windows1250.NewDecoder().Bytes(b); return string(s) }
	case 1251:
		dec = func(b []byte) string { s, _ := charmap.Windows1251.NewDecoder().Bytes(b); return string(s) }
	default:
		dec = func(b []byte) string { return string(b) }
	}
	db.strs = []string{""}
	off := 0
	for i := 4; i+4 <= len(pool); i += 4 {
		l := int(binary.LittleEndian.Uint16(pool[i:]))
		refs := binary.LittleEndian.Uint16(pool[i+2:])
		if l == 0 && refs != 0 && i+8 <= len(pool) {
			// Strings over 64 KB: the high word sits in this entry, the low word in the next.
			i += 4
			l = int(refs)<<16 | int(binary.LittleEndian.Uint16(pool[i:]))
		}
		if off+l > len(data) {
			return errors.New("corrupt string pool")
		}
		db.strs = append(db.strs, dec(data[off:off+l]))
		off += l
	}
	return nil
}

type msiCol struct {
	name   string
	str    bool
	width  int
	stored bool
}

// table returns the rows of a table as strings (integers formatted, NULL = "").
func (db *msiDB) table(name string, cols map[string][]msiCol) ([]map[string]string, error) {
	cs := cols[name]
	if len(cs) == 0 {
		return nil, fmt.Errorf("no table %s", name)
	}
	data, err := db.read("!" + name)
	if err != nil {
		return nil, nil // empty table
	}
	row := 0
	for _, c := range cs {
		if c.stored {
			row += c.width
		}
	}
	if row == 0 {
		return nil, nil
	}
	n := len(data) / row
	rows := make([]map[string]string, n)
	for i := range rows {
		rows[i] = map[string]string{}
	}
	off := 0
	for _, c := range cs {
		if !c.stored {
			continue
		}
		for r := 0; r < n; r++ {
			p := off + r*c.width
			var v uint32
			switch c.width {
			case 2:
				v = uint32(binary.LittleEndian.Uint16(data[p:]))
			case 3:
				v = uint32(data[p]) | uint32(data[p+1])<<8 | uint32(data[p+2])<<16
			case 4:
				v = binary.LittleEndian.Uint32(data[p:])
			}
			if c.str {
				if int(v) < len(db.strs) {
					rows[r][c.name] = db.strs[v]
				}
			} else if v != 0 {
				if c.width == 2 {
					rows[r][c.name] = fmt.Sprint(int32(v ^ 0x8000))
				} else {
					rows[r][c.name] = fmt.Sprint(int64(v ^ 0x80000000))
				}
			}
		}
		off += n * c.width
	}
	return rows, nil
}

func (db *msiDB) columns() (map[string][]msiCol, error) {
	data, err := db.read("!_Columns")
	if err != nil {
		return nil, err
	}
	sw := 2
	if db.wide {
		sw = 3
	}
	row := sw + 2 + sw + 2
	n := len(data) / row
	str := func(p int) string {
		v := int(data[p]) | int(data[p+1])<<8
		if sw == 3 {
			v |= int(data[p+2]) << 16
		}
		if v < len(db.strs) {
			return db.strs[v]
		}
		return ""
	}
	out := map[string][]msiCol{}
	type ent struct {
		table string
		num   int
		col   msiCol
	}
	var all []ent
	for r := 0; r < n; r++ {
		table := str(r * sw)
		num := int(binary.LittleEndian.Uint16(data[n*sw+r*2:]) ^ 0x8000)
		name := str(n*(sw+2) + r*sw)
		typ := int(binary.LittleEndian.Uint16(data[n*(sw+2+sw)+r*2:]) ^ 0x8000)
		c := msiCol{name: name, stored: typ&0x4000 == 0}
		if typ&0x0800 != 0 {
			c.str, c.width = true, sw
		} else if typ&0xff == 4 {
			c.width = 4
		} else {
			c.width = 2
		}
		all = append(all, ent{table, num, c})
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].num < all[j].num })
	for _, e := range all {
		out[e.table] = append(out[e.table], e.col)
	}
	return out, nil
}

// longName picks the long part of "SHORT~1|Long Name" and the target of "target:source".
func longName(s string) string {
	if i := strings.IndexByte(s, ':'); i >= 0 {
		s = s[:i]
	}
	if i := strings.IndexByte(s, '|'); i >= 0 {
		s = s[i+1:]
	}
	return s
}

type msiFile struct {
	key, path string
	size      int64
	seq       int
}

// msiSystemDirs names the standard Windows folders, which MSI refers to by id.
var msiSystemDirs = map[string]string{
	"ProgramFilesFolder": "Program Files", "ProgramFiles64Folder": "Program Files", "ProgramFiles6432Folder": "Program Files",
	"CommonFilesFolder": "Program Files/Common Files", "CommonFiles64Folder": "Program Files/Common Files",
	"WindowsFolder": "Windows", "SystemFolder": "Windows/System32", "System64Folder": "Windows/System32", "FontsFolder": "Windows/Fonts",
	"AppDataFolder": "AppData/Roaming", "LocalAppDataFolder": "AppData/Local", "CommonAppDataFolder": "ProgramData",
	"DesktopFolder": "Desktop", "PersonalFolder": "Documents", "ProgramMenuFolder": "Start Menu/Programs",
	"StartMenuFolder": "Start Menu", "StartupFolder": "Start Menu/Programs/Startup", "TempFolder": "Temp",
}

func walkMSI(ctx context.Context, f *os.File, fn walkFn) (map[string]string, error) {
	doc, err := mscfb.New(f)
	if err != nil {
		return nil, err
	}
	db := &msiDB{streams: map[string]*mscfb.File{}}
	for e, err := doc.Next(); err == nil; e, err = doc.Next() {
		name, table := msiName(e.Name)
		if table {
			name = "!" + name
		}
		db.streams[name] = e
	}
	if err := db.loadStrings(); err != nil {
		return nil, fmt.Errorf("not a Windows Installer package: %w", err)
	}
	cols, err := db.columns()
	if err != nil {
		return nil, err
	}
	meta := map[string]string{"Type": "Windows Installer package"}
	if props, _ := db.table("Property", cols); props != nil {
		for _, p := range props {
			switch p["Property"] {
			case "ProductName":
				meta["Package"] = p["Value"]
			case "ProductVersion":
				meta["Version"] = p["Value"]
			case "Manufacturer":
				meta["Manufacturer"] = p["Value"]
			case "ProductCode":
				meta["Product code"] = p["Value"]
			}
		}
	}
	dirs, _ := db.table("Directory", cols)
	comps, _ := db.table("Component", cols)
	files, _ := db.table("File", cols)
	media, _ := db.table("Media", cols)
	parent := map[string]string{}
	dname := map[string]string{}
	for _, d := range dirs {
		parent[d["Directory"]] = d["Directory_Parent"]
		n := longName(d["DefaultDir"])
		if d["Directory_Parent"] == "" || d["Directory_Parent"] == d["Directory"] {
			n = d["Directory"] // TARGETDIR / SourceDir: keep the folder id
			if n == "TARGETDIR" {
				n = ""
			}
		}
		if n == "." {
			n = ""
		}
		if w, ok := msiSystemDirs[d["Directory"]]; ok {
			n = w
		}
		dname[d["Directory"]] = n
	}
	var dirPath func(id string, depth int) string
	dirPath = func(id string, depth int) string {
		if id == "" || depth > 64 {
			return ""
		}
		p := parent[id]
		base := ""
		if p != "" && p != id {
			base = dirPath(p, depth+1)
		}
		switch {
		case base == "":
			return dname[id]
		case dname[id] == "":
			return base
		}
		return base + "/" + dname[id]
	}
	compDir := map[string]string{}
	for _, c := range comps {
		compDir[c["Component"]] = c["Directory_"]
	}
	var list []msiFile
	seen := map[string]bool{}
	for _, r := range files {
		dir := dirPath(compDir[r["Component_"]], 0)
		name := longName(r["FileName"])
		p := strings.Trim(dir+"/"+name, "/")
		for seen[p] { // the same name in two components of one folder
			p += "~"
		}
		seen[p] = true
		var size, seq int64
		fmt.Sscan(r["FileSize"], &size)
		fmt.Sscan(r["Sequence"], &seq)
		list = append(list, msiFile{key: r["File"], path: p, size: size, seq: int(seq)})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].seq < list[j].seq })
	type medium struct {
		last int
		cab  string
	}
	var meds []medium
	for _, m := range media {
		var last int
		fmt.Sscan(m["LastSequence"], &last)
		meds = append(meds, medium{last, m["Cabinet"]})
	}
	sort.Slice(meds, func(i, j int) bool { return meds[i].last < meds[j].last })
	cabOf := func(seq int) string {
		for _, m := range meds {
			if seq <= m.last {
				return m.cab
			}
		}
		return ""
	}
	cabs := map[string]*cabReader{}
	defer func() {
		for _, c := range cabs {
			c.close()
		}
	}()
	for _, mf := range list {
		if err := ctx.Err(); err != nil {
			return meta, err
		}
		mf := mf
		info := entryInfo{name: mf.path, size: mf.size, mode: 0o644, mod: time.Time{}}
		fi := archivesInfo(info, func() (iofs.File, error) {
			cab := cabOf(mf.seq)
			if !strings.HasPrefix(cab, "#") {
				return nil, errors.New("this file is stored outside the .msi (next to it on the install media)")
			}
			c := cabs[cab]
			if c == nil {
				s, ok := db.streams[cab[1:]]
				if !ok {
					return nil, fmt.Errorf("cabinet %s not found", cab)
				}
				var err error
				if c, err = openCab(s); err != nil {
					return nil, err
				}
				cabs[cab] = c
			}
			r, err := c.open(mf.key)
			if err != nil {
				return nil, err
			}
			return readerFile{r, info}, nil
		})
		if err := fn(fi, mf.path); err != nil {
			return meta, err
		}
	}
	return meta, nil
}

// ---------- CAB ----------

type cabFolder struct {
	dataOff int64
	blocks  int
	comp    uint16
}

type cabFile struct {
	size   int64
	off    int64
	folder int
}

type cabReader struct {
	r        io.ReaderAt
	folders  []cabFolder
	files    map[string]cabFile
	dataRes  int
	cur      *folderStream
	curIndex int
}

func openCab(r io.ReaderAt) (*cabReader, error) {
	h := make([]byte, 36)
	if _, err := r.ReadAt(h, 0); err != nil {
		return nil, err
	}
	if string(h[:4]) != "MSCF" {
		return nil, errors.New("not a cabinet")
	}
	coffFiles := int64(binary.LittleEndian.Uint32(h[16:]))
	nFolders := int(binary.LittleEndian.Uint16(h[26:]))
	nFiles := int(binary.LittleEndian.Uint16(h[28:]))
	flags := binary.LittleEndian.Uint16(h[30:])
	p := int64(36)
	folderRes, dataRes := 0, 0
	if flags&4 != 0 {
		x := make([]byte, 4)
		r.ReadAt(x, p)
		hdrRes := int64(binary.LittleEndian.Uint16(x))
		folderRes, dataRes = int(x[2]), int(x[3])
		p += 4 + hdrRes
	}
	skipStr := func() {
		b := make([]byte, 256)
		r.ReadAt(b, p)
		if i := bytes.IndexByte(b, 0); i >= 0 {
			p += int64(i) + 1
		}
	}
	if flags&1 != 0 {
		skipStr()
		skipStr()
	}
	if flags&2 != 0 {
		skipStr()
		skipStr()
	}
	c := &cabReader{r: r, files: map[string]cabFile{}, dataRes: dataRes, curIndex: -1}
	for i := 0; i < nFolders; i++ {
		b := make([]byte, 8)
		if _, err := r.ReadAt(b, p); err != nil {
			return nil, err
		}
		c.folders = append(c.folders, cabFolder{dataOff: int64(binary.LittleEndian.Uint32(b)), blocks: int(binary.LittleEndian.Uint16(b[4:])), comp: binary.LittleEndian.Uint16(b[6:])})
		p += 8 + int64(folderRes)
	}
	p = coffFiles
	for i := 0; i < nFiles; i++ {
		b := make([]byte, 16+256)
		n, _ := r.ReadAt(b, p)
		if n < 17 {
			return nil, errors.New("truncated cabinet file list")
		}
		end := bytes.IndexByte(b[16:], 0)
		if end < 0 {
			return nil, errors.New("corrupt cabinet file name")
		}
		name := string(b[16 : 16+end])
		c.files[name] = cabFile{size: int64(binary.LittleEndian.Uint32(b)), off: int64(binary.LittleEndian.Uint32(b[4:])), folder: int(binary.LittleEndian.Uint16(b[8:]))}
		p += 16 + int64(end) + 1
	}
	return c, nil
}

func (c *cabReader) close() {}

// open returns a reader for a file; files read in folder order reuse one decompressor.
func (c *cabReader) open(name string) (io.Reader, error) {
	f, ok := c.files[name]
	if !ok {
		return nil, fmt.Errorf("%s isn't in the cabinet", name)
	}
	if f.folder >= len(c.folders) {
		return nil, errors.New("this file continues in another cabinet")
	}
	fo := c.folders[f.folder]
	switch fo.comp & 0x0f {
	case 0, 1:
	case 3:
		return nil, errors.New("this file is LZX-compressed, which can't be extracted here yet")
	default:
		return nil, errors.New("this file uses Quantum compression, which isn't supported")
	}
	if c.cur == nil || c.curIndex != f.folder || c.cur.pos > f.off {
		c.cur = &folderStream{c: c, f: fo}
		c.curIndex = f.folder
	}
	if _, err := io.CopyN(io.Discard, c.cur, f.off-c.cur.pos); err != nil {
		return nil, fmt.Errorf("cabinet: %w", err)
	}
	return io.LimitReader(c.cur, f.size), nil
}

// folderStream decompresses a folder's CFDATA blocks in order.
type folderStream struct {
	c      *cabReader
	f      cabFolder
	block  int
	off    int64 // next CFDATA header
	buf    []byte
	pos    int64 // uncompressed bytes delivered
	window []byte
}

func (s *folderStream) Read(p []byte) (int, error) {
	for len(s.buf) == 0 {
		if s.block >= s.f.blocks {
			return 0, io.EOF
		}
		if s.block == 0 {
			s.off = s.f.dataOff
		}
		h := make([]byte, 8)
		if _, err := s.c.r.ReadAt(h, s.off); err != nil {
			return 0, err
		}
		cb := int(binary.LittleEndian.Uint16(h[4:]))
		ucb := int(binary.LittleEndian.Uint16(h[6:]))
		data := make([]byte, cb)
		if _, err := s.c.r.ReadAt(data, s.off+8+int64(s.c.dataRes)); err != nil && err != io.EOF {
			return 0, err
		}
		s.off += 8 + int64(s.c.dataRes) + int64(cb)
		s.block++
		if s.f.comp&0x0f == 0 {
			s.buf = data
			continue
		}
		if len(data) < 2 || data[0] != 'C' || data[1] != 'K' {
			return 0, errors.New("corrupt MSZIP block")
		}
		zr := flate.NewReaderDict(bytes.NewReader(data[2:]), s.window)
		out := make([]byte, 0, ucb)
		buf := bytes.NewBuffer(out)
		if _, err := io.Copy(buf, zr); err != nil {
			return 0, fmt.Errorf("MSZIP: %w", err)
		}
		s.buf = buf.Bytes()
		// The next block may refer back up to 32 KB.
		s.window = append(s.window, s.buf...)
		if len(s.window) > 32768 {
			s.window = append([]byte(nil), s.window[len(s.window)-32768:]...)
		}
	}
	n := copy(p, s.buf)
	s.buf = s.buf[n:]
	s.pos += int64(n)
	return n, nil
}
