package imaging

// Images this app can't decode itself — HEIC/HEIF (HEVC is patent-encumbered
// and every decoder is LGPL or worse) — are converted to PNG by the decoder
// the operating system already has: sips on macOS, Windows Imaging Component
// (through PowerShell; needs Microsoft's "HEIF Image Extensions") on
// Windows, and libheif's heif-convert / heif-dec, ImageMagick or ffmpeg on
// Linux when installed. Nothing is bundled or linked.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// ErrNoSystemDecoder means no installed tool could convert the image.
type ErrNoSystemDecoder struct{ Hint string }

func (e ErrNoSystemDecoder) Error() string { return e.Hint }

type converter struct {
	name string
	args func(src, dst string) []string
}

func converters() []converter {
	switch runtime.GOOS {
	case "darwin":
		return []converter{{"sips", func(s, d string) []string { return []string{"-s", "format", "png", s, "--out", d} }}}
	case "windows":
		return []converter{{"powershell", func(s, d string) []string {
			q := func(p string) string { return "'" + strings.ReplaceAll(p, "'", "''") + "'" }
			script := "$ErrorActionPreference='Stop';Add-Type -AssemblyName PresentationCore;" +
				"$s=[IO.File]::OpenRead(" + q(s) + ");" +
				"$d=[Windows.Media.Imaging.BitmapDecoder]::Create($s,[Windows.Media.Imaging.BitmapCreateOptions]::None,[Windows.Media.Imaging.BitmapCacheOption]::OnLoad);" +
				"$e=New-Object Windows.Media.Imaging.PngBitmapEncoder;$e.Frames.Add($d.Frames[0]);" +
				"$o=[IO.File]::Create(" + q(d) + ");$e.Save($o);$o.Close();$s.Close()"
			return []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script}
		}}}
	default:
		return []converter{
			{"heif-dec", func(s, d string) []string { return []string{s, d} }},
			{"heif-convert", func(s, d string) []string { return []string{s, d} }},
			{"magick", func(s, d string) []string { return []string{s + "[0]", d} }},
			{"convert", func(s, d string) []string { return []string{s + "[0]", d} }},
			{"ffmpeg", func(s, d string) []string {
				return []string{"-hide_banner", "-loglevel", "error", "-y", "-i", s, "-frames:v", "1", d}
			}},
		}
	}
}

func hint() string {
	switch runtime.GOOS {
	case "windows":
		return "Windows can't decode HEIC here. Install “HEIF Image Extensions” (and “HEVC Video Extensions”) from the Microsoft Store, then open the file again."
	case "darwin":
		return "macOS couldn't convert this image."
	default:
		return "No HEIC decoder is installed. Install libheif's tools (e.g. “sudo apt install libheif-examples”, “sudo dnf install libheif-tools”) or ImageMagick with HEIC support, then open the file again."
	}
}

// ConvertWithSystem writes src as PNG to dst using the first tool that
// works, and returns that tool's name.
func ConvertWithSystem(ctx context.Context, src, dst string) (string, error) {
	var errs []string
	for _, c := range converters() {
		path, err := exec.LookPath(c.name)
		if err != nil {
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
		cmd := exec.CommandContext(cctx, path, c.args(src, dst)...)
		hideWindow(cmd)
		out, err := cmd.CombinedOutput()
		cancel()
		if err == nil {
			if st, serr := os.Stat(dst); serr == nil && st.Size() > 0 {
				return c.name, nil
			}
			err = errors.New("no output")
		}
		errs = append(errs, fmt.Sprintf("%s: %v %s", c.name, err, strings.TrimSpace(string(out))))
		os.Remove(dst)
	}
	if len(errs) == 0 {
		return "", ErrNoSystemDecoder{Hint: hint()}
	}
	return "", ErrNoSystemDecoder{Hint: hint() + " (" + strings.Join(errs, "; ") + ")"}
}
