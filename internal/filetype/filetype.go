// Package filetype maps files to the kind of viewer that handles them: by
// extension first, falling back to magic bytes and a text heuristic.
package filetype

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

type Kind string

const (
	Text     Kind = "text"
	Markdown Kind = "markdown"
	PDF      Kind = "pdf"
	Image    Kind = "image"
	SVG      Kind = "svg"
	JSON     Kind = "json"
	YAML     Kind = "yaml"
	CSV      Kind = "csv"
	Archive  Kind = "archive"
	Checksum Kind = "checksum"
	Document Kind = "document"
	Sheet    Kind = "spreadsheet"
	Model    Kind = "model"
	Audio    Kind = "audio"
	Video    Kind = "video"
	Database Kind = "database"
	CAD      Kind = "cad"
	Binary   Kind = "binary"
	Unknown  Kind = ""
)

// Info is the detection result.
type Info struct {
	Kind    Kind   `json:"kind"`
	Mime    string `json:"mime"`
	Ext     string `json:"ext"`     // normalized extension without dot, e.g. "tar.gz"
	ByMagic bool   `json:"byMagic"` // true when the extension was not conclusive
}

type entry struct {
	kind Kind
	mime string
}

// compound extensions are checked before the final extension.
var compound = map[string]entry{
	"tar.gz":  {Archive, "application/gzip"},
	"tar.bz2": {Archive, "application/x-bzip2"},
	"tar.xz":  {Archive, "application/x-xz"},
	"tar.zst": {Archive, "application/zstd"},
}

var byExt = map[string]entry{
	// markdown
	"md": {Markdown, "text/markdown"}, "markdown": {Markdown, "text/markdown"}, "mdown": {Markdown, "text/markdown"}, "mkd": {Markdown, "text/markdown"},
	// documents
	"pdf": {PDF, "application/pdf"},
	// images
	"png": {Image, "image/png"}, "jpg": {Image, "image/jpeg"}, "jpeg": {Image, "image/jpeg"}, "jfif": {Image, "image/jpeg"},
	"gif": {Image, "image/gif"}, "webp": {Image, "image/webp"}, "bmp": {Image, "image/bmp"}, "ora": {Image, "image/openraster"},
	"heic": {Image, "image/heic"}, "heif": {Image, "image/heif"}, "avif": {Image, "image/avif"},
	"ico": {Image, "image/x-icon"}, "cur": {Image, "image/x-icon"}, "icns": {Image, "image/icns"},
	"svg": {SVG, "image/svg+xml"},
	"glb": {Model, "model/gltf-binary"}, "gltf": {Model, "model/gltf+json"}, "fbx": {Model, "application/octet-stream"},
	"obj": {Model, "model/obj"}, "stl": {Model, "model/stl"}, "ply": {Model, "application/octet-stream"}, "3mf": {Model, "model/3mf"},
	"dae": {Model, "model/vnd.collada+xml"}, "3ds": {Model, "application/octet-stream"}, "usdz": {Model, "model/vnd.usdz+zip"},
	"usd": {Model, "application/octet-stream"}, "usda": {Model, "text/plain"}, "usdc": {Model, "application/octet-stream"},
	"wrl": {Model, "model/vrml"}, "vrml": {Model, "model/vrml"}, "amf": {Model, "application/octet-stream"},
	"pcd": {Model, "application/octet-stream"}, "xyz": {Model, "text/plain"}, "vtk": {Model, "application/octet-stream"}, "vtp": {Model, "application/octet-stream"},
	// media
	"mp3": {Audio, "audio/mpeg"}, "wav": {Audio, "audio/wav"}, "flac": {Audio, "audio/flac"}, "ogg": {Audio, "audio/ogg"},
	"oga": {Audio, "audio/ogg"}, "opus": {Audio, "audio/ogg"}, "m4a": {Audio, "audio/mp4"}, "aac": {Audio, "audio/aac"},
	"weba": {Audio, "audio/webm"}, "mka": {Audio, "audio/x-matroska"}, "aif": {Audio, "audio/aiff"}, "aiff": {Audio, "audio/aiff"},
	"mp4": {Video, "video/mp4"}, "m4v": {Video, "video/mp4"}, "mov": {Video, "video/quicktime"}, "webm": {Video, "video/webm"},
	"mkv": {Video, "video/x-matroska"}, "ogv": {Video, "video/ogg"}, "avi": {Video, "video/x-msvideo"},
	// CAD drawings
	"dxf": {CAD, "image/vnd.dxf"},
	// SQLite databases
	"db": {Database, "application/vnd.sqlite3"}, "sqlite": {Database, "application/vnd.sqlite3"}, "sqlite3": {Database, "application/vnd.sqlite3"},
	"db3": {Database, "application/vnd.sqlite3"}, "s3db": {Database, "application/vnd.sqlite3"}, "sl3": {Database, "application/vnd.sqlite3"},
	// data
	"json": {JSON, "application/json"}, "jsonc": {JSON, "application/json"}, "geojson": {JSON, "application/geo+json"}, "webmanifest": {JSON, "application/manifest+json"},
	"yaml": {YAML, "application/yaml"}, "yml": {YAML, "application/yaml"},
	"csv": {CSV, "text/csv"}, "tsv": {CSV, "text/tab-separated-values"}, "tab": {CSV, "text/tab-separated-values"},
	// archives
	"zip": {Archive, "application/zip"}, "tar": {Archive, "application/x-tar"}, "gz": {Archive, "application/gzip"},
	"tgz": {Archive, "application/gzip"}, "7z": {Archive, "application/x-7z-compressed"}, "rar": {Archive, "application/vnd.rar"},
	"bz2": {Archive, "application/x-bzip2"}, "xz": {Archive, "application/x-xz"}, "zst": {Archive, "application/zstd"},
	"tbz2": {Archive, "application/x-bzip2"}, "txz": {Archive, "application/x-xz"},
	// packages and disk images, browsed like archives
	"deb": {Archive, "application/vnd.debian.binary-package"}, "udeb": {Archive, "application/vnd.debian.binary-package"},
	"rpm": {Archive, "application/x-rpm"}, "iso": {Archive, "application/x-iso9660-image"}, "msi": {Archive, "application/x-msi"},
	"jar": {Archive, "application/java-archive"}, "war": {Archive, "application/java-archive"}, "ear": {Archive, "application/java-archive"},
	"aar": {Archive, "application/zip"}, "apk": {Archive, "application/vnd.android.package-archive"}, "xapk": {Archive, "application/zip"},
	"apks": {Archive, "application/zip"}, "ipa": {Archive, "application/zip"}, "xpi": {Archive, "application/x-xpinstall"},
	"vsix": {Archive, "application/zip"}, "nupkg": {Archive, "application/zip"}, "whl": {Archive, "application/zip"},
	"appx": {Archive, "application/zip"}, "msix": {Archive, "application/zip"}, "appxbundle": {Archive, "application/zip"}, "msixbundle": {Archive, "application/zip"},
	// office
	"docx": {Document, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}, "doc": {Document, "application/msword"},
	"xlsx": {Sheet, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, "xlsm": {Sheet, "application/vnd.ms-excel.sheet.macroEnabled.12"},
	"xls": {Sheet, "application/vnd.ms-excel"},
	"odt": {Document, "application/vnd.oasis.opendocument.text"}, "ott": {Document, "application/vnd.oasis.opendocument.text-template"},
	"ods": {Sheet, "application/vnd.oasis.opendocument.spreadsheet"}, "ots": {Sheet, "application/vnd.oasis.opendocument.spreadsheet-template"},
	// checksum lists
	"sha256": {Checksum, "text/plain"}, "sha1": {Checksum, "text/plain"}, "md5": {Checksum, "text/plain"},
	"sha512": {Checksum, "text/plain"}, "b3": {Checksum, "text/plain"}, "sha256sum": {Checksum, "text/plain"},
	"md5sum": {Checksum, "text/plain"}, "sha1sum": {Checksum, "text/plain"}, "sha512sum": {Checksum, "text/plain"},
}

// textExts are common text/code formats; anything not listed still opens as
// text if its content looks like text.
var textExts = []string{
	"txt", "log", "ini", "cfg", "conf", "toml", "env", "properties", "xml", "html", "htm", "css", "scss", "less",
	"js", "mjs", "cjs", "jsx", "ts", "tsx", "svelte", "vue", "go", "mod", "sum", "rs", "py", "rb", "php", "java", "kt", "kts",
	"c", "h", "cc", "cpp", "cxx", "hpp", "hh", "cs", "swift", "m", "mm", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
	"sql", "lua", "pl", "r", "dart", "scala", "clj", "ex", "exs", "erl", "hs", "elm", "jl", "nim", "zig", "tex", "rst",
	"adoc", "gitignore", "gitattributes", "editorconfig", "dockerfile", "makefile", "cmake", "gradle", "diff", "patch", "srt", "vtt",
}

// knownTextNames are files without an extension that are text.
var knownTextNames = map[string]bool{
	"makefile": true, "dockerfile": true, "readme": true, "license": true, "copying": true, "authors": true,
	"changelog": true, "gemfile": true, "rakefile": true, "procfile": true, "vagrantfile": true, "justfile": true,
	"sha256sums": true, "md5sums": true, "sha1sums": true, "sha512sums": true,
}

func init() {
	for _, e := range textExts {
		if _, ok := byExt[e]; !ok {
			byExt[e] = entry{Text, "text/plain"}
		}
	}
}

// Ext returns the normalized (lower-case, no dot) extension, recognizing
// compound archive extensions such as "tar.gz".
func Ext(name string) string {
	base := strings.ToLower(filepath.Base(name))
	for c := range compound {
		if strings.HasSuffix(base, "."+c) {
			return c
		}
	}
	e := filepath.Ext(base)
	if e == "" {
		return ""
	}
	return e[1:]
}

// ByName detects the kind from the file name alone. Kind is Unknown when the
// name is not conclusive.
func ByName(name string) Info {
	ext := Ext(name)
	if e, ok := compound[ext]; ok {
		return Info{Kind: e.kind, Mime: e.mime, Ext: ext}
	}
	if e, ok := byExt[ext]; ok {
		return Info{Kind: e.kind, Mime: e.mime, Ext: ext}
	}
	base := strings.ToLower(filepath.Base(name))
	if knownTextNames[base] {
		if strings.HasSuffix(base, "sums") {
			return Info{Kind: Checksum, Mime: "text/plain", Ext: ext}
		}
		return Info{Kind: Text, Mime: "text/plain", Ext: ext}
	}
	return Info{Kind: Unknown, Ext: ext}
}

// Detect inspects name and, when needed, the first bytes of the file.
func Detect(path string) (Info, error) {
	info := ByName(path)
	if info.Kind != Unknown {
		return info, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return info, err
	}
	defer f.Close()
	head := make([]byte, 4096)
	n, err := io.ReadFull(f, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return info, err
	}
	sniffed := Sniff(head[:n])
	sniffed.Ext = info.Ext
	return sniffed, nil
}

// Sniff detects the kind from leading bytes.
func Sniff(b []byte) Info {
	m := func(k Kind, mime string) Info { return Info{Kind: k, Mime: mime, ByMagic: true} }
	switch {
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return m(PDF, "application/pdf")
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return m(Image, "image/png")
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return m(Image, "image/jpeg")
	case bytes.HasPrefix(b, []byte("GIF87a")), bytes.HasPrefix(b, []byte("GIF89a")):
		return m(Image, "image/gif")
	case len(b) >= 12 && bytes.Equal(b[0:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP")):
		return m(Image, "image/webp")
	case len(b) >= 14 && bytes.HasPrefix(b, []byte("BM")) && validBMP(b):
		return m(Image, "image/bmp")
	case bytes.HasPrefix(b, []byte("SQLite format 3\x00")):
		return m(Database, "application/vnd.sqlite3")
	case bytes.HasPrefix(b, []byte("PK\x03\x04")), bytes.HasPrefix(b, []byte("PK\x05\x06")):
		return m(Archive, "application/zip")
	case bytes.HasPrefix(b, []byte("Rar!\x1a\x07")):
		return m(Archive, "application/vnd.rar")
	case bytes.HasPrefix(b, []byte{'7', 'z', 0xBC, 0xAF, 0x27, 0x1C}):
		return m(Archive, "application/x-7z-compressed")
	case bytes.HasPrefix(b, []byte{0x1F, 0x8B}):
		return m(Archive, "application/gzip")
	case bytes.HasPrefix(b, []byte("BZh")) && len(b) > 3 && b[3] >= '1' && b[3] <= '9':
		return m(Archive, "application/x-bzip2")
	case bytes.HasPrefix(b, []byte{0xFD, '7', 'z', 'X', 'Z', 0x00}):
		return m(Archive, "application/x-xz")
	case bytes.HasPrefix(b, []byte{0x28, 0xB5, 0x2F, 0xFD}):
		return m(Archive, "application/zstd")
	case bytes.HasPrefix(b, []byte("!<arch>\ndebian-binary")):
		return m(Archive, "application/vnd.debian.binary-package")
	case bytes.HasPrefix(b, []byte{0xED, 0xAB, 0xEE, 0xDB}):
		return m(Archive, "application/x-rpm")
	case len(b) >= 262 && bytes.Equal(b[257:262], []byte("ustar")):
		return m(Archive, "application/x-tar")
	}
	if !LooksLikeText(b) {
		return m(Binary, "application/octet-stream")
	}
	t := bytes.TrimLeft(b, "\xef\xbb\xbf \t\r\n")
	switch {
	case bytes.HasPrefix(t, []byte("<svg")), bytes.HasPrefix(t, []byte("<?xml")) && bytes.Contains(b, []byte("<svg")):
		return m(SVG, "image/svg+xml")
	case len(t) > 0 && (t[0] == '{' || t[0] == '['):
		return m(JSON, "application/json")
	case bytes.HasPrefix(t, []byte("---\n")), bytes.HasPrefix(t, []byte("---\r\n")):
		return m(YAML, "application/yaml")
	}
	return m(Text, "text/plain")
}

func validBMP(b []byte) bool {
	// The reserved fields at offset 6..9 are zero in real bitmaps.
	return b[6] == 0 && b[7] == 0 && b[8] == 0 && b[9] == 0
}

// LooksLikeText reports whether b is plausibly text: UTF-16 with a BOM, or
// no NUL bytes and mostly valid UTF-8 / printable single-byte characters.
func LooksLikeText(b []byte) bool {
	if len(b) == 0 {
		return true
	}
	if bytes.HasPrefix(b, []byte{0xFF, 0xFE}) || bytes.HasPrefix(b, []byte{0xFE, 0xFF}) {
		return true
	}
	if bytes.IndexByte(b, 0) >= 0 {
		return false
	}
	// Allow a truncated multi-byte sequence at the end of the sample.
	if utf8.Valid(trimPartialRune(b)) {
		return true
	}
	ctrl := 0
	for _, c := range b {
		if c < 0x20 && c != '\n' && c != '\r' && c != '\t' && c != '\f' && c != 0x1b {
			ctrl++
		}
	}
	return ctrl*100/len(b) < 5
}

func trimPartialRune(b []byte) []byte {
	for i := 1; i <= 3 && i <= len(b); i++ {
		if utf8.RuneStart(b[len(b)-i]) {
			if !utf8.FullRune(b[len(b)-i:]) {
				return b[:len(b)-i]
			}
			break
		}
	}
	return b
}
