// Package cli is Monoform's command line: `monoform FILE…` opens files in
// the app; `monoform hash`, `verify`, `info` and `convert` work headless, for
// scripts (output like sha256sum, exit codes 0 = fine, 1 = a check failed,
// 2 = usage or I/O error).
package cli

import (
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"

	"github.com/caffeine-runtime/monoform/internal/convert"
	"github.com/caffeine-runtime/monoform/internal/filetype"
	"github.com/caffeine-runtime/monoform/internal/hash"
	"github.com/caffeine-runtime/monoform/internal/pdf"
)

const usage = `Monoform — one window for your everyday files.

Usage:
  monoform [FILE...]                 open files in the app (a running window takes them)
  monoform --peek FILE               a small preview window (Open in editor expands it)
  monoform --preview FILE...         open files in preview mode (read-only until you choose Edit)

  monoform hash [-a ALGO[,ALGO]] FILE...   print checksums (sha256 by default; md5, sha1,
                                        sha256, sha512, blake3 or all), like sha256sum
  monoform verify CHECKSUMS...            check files against SHA256SUMS / *.sha256 / BSD lists
  monoform info FILE...                   type, size and details (pages, image size)
  monoform convert IN OUT                 convert a file; the format comes from OUT's extension:
                                        pictures (png jpg webp gif bmp tiff ico icns pdf; HEIC
                                        via the system), audio (flac wav), tables (xlsx csv tsv
                                        json pdf), documents (pdf docx html md txt)
  monoform help | version

Exit codes: 0 fine, 1 a check failed, 2 usage or I/O error.
`

// Commands that run without the app.
var commands = map[string]func(ctx context.Context, args []string, out, errw io.Writer) int{
	"hash":    cmdHash,
	"verify":  cmdVerify,
	"info":    cmdInfo,
	"convert": cmdConvert,
}

// Main runs a command-line subcommand. ok is false when the arguments are
// files to open (or none): the caller starts the app then.
func Main(args []string, version string, out, errw io.Writer) (code int, ok bool) {
	if len(args) == 0 {
		return 0, false
	}
	switch args[0] {
	case "help", "-h", "--help", "/?":
		fmt.Fprint(out, usage)
		return 0, true
	case "version", "-v", "--version":
		fmt.Fprintf(out, "Monoform %s\n", version)
		return 0, true
	}
	f, isCmd := commands[args[0]]
	if !isCmd {
		return 0, false
	}
	// A file literally named "hash" etc. still opens.
	if len(args) == 1 {
		if _, err := os.Stat(args[0]); err == nil {
			return 0, false
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	return f(ctx, args[1:], out, errw), true
}

// expand applies glob patterns the shell didn't expand (Windows' cmd and
// PowerShell pass "*.iso" through).
func expand(args []string) []string {
	var out []string
	for _, a := range args {
		if strings.ContainsAny(a, "*?[") {
			if _, err := os.Stat(a); err != nil {
				if m, err := filepath.Glob(a); err == nil && len(m) > 0 {
					sort.Strings(m)
					out = append(out, m...)
					continue
				}
			}
		}
		out = append(out, a)
	}
	return out
}

func cmdHash(ctx context.Context, args []string, out, errw io.Writer) int {
	algos := []string{"sha256"}
	var files []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-a" || a == "--algorithm":
			if i+1 >= len(args) {
				fmt.Fprintln(errw, "monoform hash: -a needs an algorithm")
				return 2
			}
			i++
			algos = strings.Split(strings.ToLower(args[i]), ",")
		case strings.HasPrefix(a, "--algorithm="):
			algos = strings.Split(strings.ToLower(strings.TrimPrefix(a, "--algorithm=")), ",")
		case a == "--":
			files = append(files, args[i+1:]...)
			i = len(args)
		default:
			files = append(files, a)
		}
	}
	if len(algos) == 1 && algos[0] == "all" {
		algos = hash.Algorithms
	}
	for _, al := range algos {
		if !contains(hash.Algorithms, al) {
			fmt.Fprintf(errw, "monoform hash: unknown algorithm %q (use %s or all)\n", al, strings.Join(hash.Algorithms, ", "))
			return 2
		}
	}
	files = expand(files)
	if len(files) == 0 {
		fmt.Fprintln(errw, "usage: monoform hash [-a ALGO[,ALGO]] FILE...")
		return 2
	}
	code := 0
	for _, f := range files {
		st, err := os.Stat(f)
		if err == nil && st.IsDir() {
			err = errors.New("is a folder")
		}
		var sums map[string]string
		if err == nil {
			sums, err = hash.File(ctx, f, algos, nil)
		}
		if err != nil {
			fmt.Fprintf(errw, "monoform hash: %s: %v\n", f, cleanErr(err))
			code = 2
			if ctx.Err() != nil {
				return 2
			}
			continue
		}
		for _, al := range algos {
			if len(algos) == 1 {
				fmt.Fprintf(out, "%s  %s\n", sums[al], f) // GNU sha256sum format
			} else {
				fmt.Fprintf(out, "%s (%s) = %s\n", strings.ToUpper(al), f, sums[al]) // BSD format
			}
		}
	}
	return code
}

func cmdVerify(ctx context.Context, args []string, out, errw io.Writer) int {
	files := expand(args)
	if len(files) == 0 {
		fmt.Fprintln(errw, "usage: monoform verify CHECKSUM-FILE...")
		return 2
	}
	code := 0
	var ok, bad, missing int
	for _, f := range files {
		lines, err := hash.ParseChecksumFile(f)
		if err != nil {
			fmt.Fprintf(errw, "monoform verify: %s: %v\n", f, cleanErr(err))
			code = 2
			continue
		}
		for _, l := range lines {
			// Names are relative to the list's folder; like sha256sum -c,
			// also accept them relative to the current folder.
			p := l.Path
			if _, err := os.Stat(p); err != nil && !filepath.IsAbs(l.Name) {
				if _, err := os.Stat(l.Name); err == nil {
					p = l.Name
				}
			}
			if _, err := os.Stat(p); err != nil {
				missing++
				fmt.Fprintf(out, "%s: MISSING\n", l.Name)
				continue
			}
			sums, err := hash.File(ctx, p, []string{l.Algo}, nil)
			switch {
			case err != nil:
				bad++
				fmt.Fprintf(out, "%s: FAILED (%v)\n", l.Name, cleanErr(err))
				if ctx.Err() != nil {
					return 2
				}
			case strings.EqualFold(sums[l.Algo], l.Expected):
				ok++
				fmt.Fprintf(out, "%s: OK\n", l.Name)
			default:
				bad++
				fmt.Fprintf(out, "%s: FAILED\n", l.Name)
			}
		}
	}
	if bad+missing > 0 {
		fmt.Fprintf(errw, "monoform verify: %d OK, %d failed, %d missing\n", ok, bad, missing)
		if code == 0 {
			code = 1
		}
	}
	return code
}

func cmdInfo(ctx context.Context, args []string, out, errw io.Writer) int {
	files := expand(args)
	if len(files) == 0 {
		fmt.Fprintln(errw, "usage: monoform info FILE...")
		return 2
	}
	code := 0
	for i, f := range files {
		st, err := os.Stat(f)
		if err != nil {
			fmt.Fprintf(errw, "monoform info: %s: %v\n", f, cleanErr(err))
			code = 2
			continue
		}
		if i > 0 {
			fmt.Fprintln(out)
		}
		fmt.Fprintln(out, f)
		if st.IsDir() {
			fmt.Fprintln(out, "  type: folder")
			continue
		}
		ft, _ := filetype.Detect(f)
		fmt.Fprintf(out, "  type: %s (%s)\n", ft.Kind, ft.Mime)
		fmt.Fprintf(out, "  size: %s (%d bytes)\n", human(st.Size()), st.Size())
		fmt.Fprintf(out, "  modified: %s\n", st.ModTime().Format("2006-01-02 15:04:05"))
		switch ft.Kind {
		case filetype.PDF:
			if n, err := pdf.PageCount(ctx, f); err == nil {
				fmt.Fprintf(out, "  pages: %d\n", n)
			}
		case filetype.Image:
			if fh, err := os.Open(f); err == nil {
				if c, format, err := image.DecodeConfig(fh); err == nil {
					fmt.Fprintf(out, "  image: %d × %d %s\n", c.Width, c.Height, format)
				}
				fh.Close()
			}
		}
	}
	return code
}

func cmdConvert(ctx context.Context, args []string, out, errw io.Writer) int {
	if len(args) != 2 {
		fmt.Fprintln(errw, "usage: monoform convert IN OUT   (format from OUT's extension)")
		return 2
	}
	src, dst := args[0], args[1]
	res, err := convert.Convert(ctx, src, dst, nil)
	if err != nil {
		if errors.Is(err, convert.ErrUnsupported) {
			if t := convert.Targets(src); len(t) > 0 {
				err = fmt.Errorf("%v (.%s converts to %s)", err, convert.Ext(src), strings.Join(t, ", "))
			}
		}
		fmt.Fprintf(errw, "monoform convert: %s: %v\n", src, cleanErr(err))
		return 2
	}
	line := src + " → " + dst
	for _, p := range []string{src, dst} { // a picture's size (HEIC: the result's)
		fh, err := os.Open(p)
		if err != nil {
			continue
		}
		c, _, err := image.DecodeConfig(fh)
		fh.Close()
		if err == nil {
			line += fmt.Sprintf(" (%d × %d)", c.Width, c.Height)
			break
		}
	}
	if res.Note != "" {
		line += "; " + res.Note
	}
	fmt.Fprintln(out, line)
	return 0
}

func human(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

func cleanErr(err error) error {
	var pe *os.PathError
	if errors.As(err, &pe) {
		return pe.Err
	}
	return err
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// ExeDir is the folder of the running program (where monoform finds the app).
func ExeDir() string {
	p, err := os.Executable()
	if err != nil {
		return "."
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return filepath.Dir(p)
}

// AppPath is the desktop app next to monoform.
func AppPath() string {
	dir := ExeDir()
	switch runtime.GOOS {
	case "windows":
		return filepath.Join(dir, "monoform.exe")
	case "darwin":
		// Inside the bundle: Contents/MacOS/monoform-cli next to the app binary.
		for _, n := range []string{"Monoform", "monoform"} {
			if _, err := os.Stat(filepath.Join(dir, n)); err == nil {
				return filepath.Join(dir, n)
			}
		}
	}
	return filepath.Join(dir, "monoform")
}

// IsCommand says whether args ask for a command-line subcommand (not files to open).
func IsCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "help", "-h", "--help", "/?", "version", "-v", "--version":
		return true
	}
	if _, ok := commands[args[0]]; !ok {
		return false
	}
	if len(args) == 1 {
		if _, err := os.Stat(args[0]); err == nil {
			return false
		}
	}
	return true
}
