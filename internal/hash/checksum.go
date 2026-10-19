package hash

import (
	"bufio"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Line is one entry of a checksum file.
type Line struct {
	Algo     string `json:"algo"`
	Expected string `json:"expected"`
	Name     string `json:"name"` // as written in the file
	Path     string `json:"path"` // resolved against the checksum file's folder
	LineNo   int    `json:"line"`
}

var (
	bsdLine = regexp.MustCompile(`^(MD5|SHA1|SHA256|SHA512|BLAKE3|SHA-1|SHA-256|SHA-512)\s*\((.+)\)\s*=\s*([0-9a-fA-F]+)\s*$`)
	gnuLine = regexp.MustCompile(`^\\?([0-9a-fA-F]{32,128})\s[ *]?(.+)$`)
)

// algoFromName picks the algorithm from a checksum file name.
func algoFromName(p string) string {
	n := strings.ToLower(filepath.Base(p))
	switch {
	case strings.Contains(n, "sha512"):
		return "sha512"
	case strings.Contains(n, "sha256"):
		return "sha256"
	case strings.Contains(n, "sha1"):
		return "sha1"
	case strings.Contains(n, "md5"):
		return "md5"
	case strings.HasSuffix(n, ".b3") || strings.Contains(n, "b3sum") || strings.Contains(n, "blake3"):
		return "blake3"
	}
	return ""
}

// ParseChecksumFile reads a checksum file. Lines that aren't checksums
// (comments, blank lines) are ignored.
func ParseChecksumFile(path string) ([]Line, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Parse(f, path)
}

func Parse(r io.Reader, path string) ([]Line, error) {
	base := filepath.Dir(path)
	hint := algoFromName(path)
	var out []Line
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	n := 0
	for sc.Scan() {
		n++
		s := strings.TrimRight(strings.TrimPrefix(sc.Text(), "\ufeff"), "\r ")
		if s == "" || strings.HasPrefix(s, "#") || strings.HasPrefix(s, ";") {
			continue
		}
		var l Line
		if m := bsdLine.FindStringSubmatch(s); m != nil {
			l = Line{Algo: strings.ToLower(strings.ReplaceAll(m[1], "-", "")), Name: m[2], Expected: strings.ToLower(m[3])}
		} else if m := gnuLine.FindStringSubmatch(s); m != nil {
			name := m[2]
			if strings.HasPrefix(s, "\\") {
				name = unescape(name)
			}
			l = Line{Expected: strings.ToLower(m[1]), Name: name}
			guess := GuessAlgorithm(l.Expected)
			switch {
			case hint != "" && contains(guess, hint):
				l.Algo = hint
			case len(guess) > 0:
				l.Algo = guess[0]
			default:
				continue
			}
		} else {
			continue
		}
		l.LineNo = n
		name := filepath.FromSlash(l.Name)
		if filepath.IsAbs(name) {
			l.Path = name
		} else {
			l.Path = filepath.Join(base, name)
		}
		out = append(out, l)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, errors.New("no checksums found in this file")
	}
	return out, nil
}

func unescape(s string) string {
	r := strings.NewReplacer(`\\`, `\`, `\n`, "\n", `\r`, "\r")
	return r.Replace(s)
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// Result of verifying one line.
type Result struct {
	Line
	Actual string `json:"actual"`
	Status string `json:"status"` // "ok", "mismatch", "missing", "error"
	Error  string `json:"error,omitempty"`
}

// Verify checks every file listed in a checksum file. onResult receives each
// result as soon as it is known; progress covers the total size of all files.
func Verify(ctx context.Context, path string, onResult func(Result), progress Progress) ([]Result, error) {
	lines, err := ParseChecksumFile(path)
	if err != nil {
		return nil, err
	}
	var total int64
	for _, l := range lines {
		if st, err := os.Stat(l.Path); err == nil {
			total += st.Size()
		}
	}
	var base int64
	out := make([]Result, 0, len(lines))
	for _, l := range lines {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		res := Result{Line: l}
		st, err := os.Stat(l.Path)
		switch {
		case err != nil:
			res.Status = "missing"
		case st.IsDir():
			res.Status, res.Error = "error", "is a folder"
		default:
			sums, err := File(ctx, l.Path, []string{l.Algo}, func(done, _ int64) {
				if progress != nil {
					progress(base+done, total)
				}
			})
			if err != nil {
				if ctx.Err() != nil {
					return out, ctx.Err()
				}
				res.Status, res.Error = "error", err.Error()
			} else {
				res.Actual = sums[l.Algo]
				if res.Actual == l.Expected {
					res.Status = "ok"
				} else {
					res.Status = "mismatch"
				}
			}
			base += st.Size()
		}
		out = append(out, res)
		if onResult != nil {
			onResult(res)
		}
	}
	return out, nil
}
