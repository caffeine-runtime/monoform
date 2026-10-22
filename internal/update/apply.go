package update

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Apply puts a downloaded package in place of the running copy at exe and
// returns the command that starts the new version. The running files are
// renamed to *.old (a running program can be renamed, also on Windows) and
// removed by CleanOld on the next start. Windows installs made by the setup
// program update through it instead (app.UpdateInstall).
//
//	Linux:   monoform-linux-amd64.tar.gz → the monoform binary
//	macOS:   monoform-macos-universal.zip → the Monoform.app bundle
//	Windows: monoform-windows-amd64-portable.zip → monoform.exe (+ monoform-cli.exe)
func Apply(pkg, exe string) ([]string, error) {
	switch {
	case strings.HasSuffix(pkg, ".tar.gz"):
		return applyTar(pkg, exe)
	case GOOS == "darwin":
		return applyBundle(pkg, exe)
	case strings.HasSuffix(pkg, ".zip"):
		return applyPortable(pkg, exe)
	}
	return nil, fmt.Errorf("don't know how to install %s", filepath.Base(pkg))
}

// stage is a fresh folder next to dst, so the final renames stay on one disk.
func stage(dst string) (string, error) {
	return os.MkdirTemp(filepath.Dir(dst), ".monoform-update-")
}

func applyTar(pkg, exe string) ([]string, error) {
	dir, err := stage(exe)
	if err != nil {
		return nil, fmt.Errorf("can't write next to %s: %w", exe, err)
	}
	defer os.RemoveAll(dir)
	if err := extractTarGz(pkg, dir); err != nil {
		return nil, err
	}
	bin := filepath.Join(dir, "monoform", "monoform")
	if _, err := os.Stat(bin); err != nil {
		return nil, errors.New("the package has no monoform program")
	}
	if err := ReplaceFile(exe, bin); err != nil {
		return nil, err
	}
	return []string{exe}, nil
}

func applyPortable(pkg, exe string) ([]string, error) {
	dir, err := stage(exe)
	if err != nil {
		return nil, fmt.Errorf("can't write next to %s: %w", exe, err)
	}
	defer os.RemoveAll(dir)
	if err := extractZip(pkg, dir); err != nil {
		return nil, err
	}
	main := filepath.Join(dir, "monoform.exe")
	if _, err := os.Stat(main); err != nil {
		return nil, errors.New("the package has no monoform.exe")
	}
	if err := ReplaceFile(exe, main); err != nil {
		return nil, err
	}
	cli := filepath.Join(filepath.Dir(exe), "monoform-cli.exe")
	if _, err := os.Stat(filepath.Join(dir, "monoform-cli.exe")); err == nil {
		_ = ReplaceFile(cli, filepath.Join(dir, "monoform-cli.exe"))
	}
	return []string{exe}, nil
}

// BundleOf is the .app folder an executable inside it belongs to ("" if none).
func BundleOf(exe string) string {
	i := strings.LastIndex(exe, ".app/")
	if i < 0 {
		return ""
	}
	return exe[:i+4]
}

func applyBundle(pkg, exe string) ([]string, error) {
	bundle := BundleOf(exe)
	if bundle == "" {
		return nil, errors.New("Monoform isn't running from an app bundle")
	}
	dir, err := stage(bundle)
	if err != nil {
		return nil, fmt.Errorf("can't write next to %s: %w", bundle, err)
	}
	defer os.RemoveAll(dir)
	if err := extractZip(pkg, dir); err != nil {
		return nil, err
	}
	var app string
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() && strings.HasSuffix(e.Name(), ".app") {
			app = filepath.Join(dir, e.Name())
		}
	}
	if app == "" {
		return nil, errors.New("the package has no app")
	}
	old := bundle + ".old"
	os.RemoveAll(old)
	if err := os.Rename(bundle, old); err != nil {
		return nil, err
	}
	if err := os.Rename(app, bundle); err != nil {
		_ = os.Rename(old, bundle)
		return nil, err
	}
	return []string{"open", "-n", bundle, "--args"}, nil
}

// ReplaceFile puts src at dst; dst may be running. The old file is kept as dst.old until CleanOld.
func ReplaceFile(dst, src string) error {
	old := dst + ".old"
	os.Remove(old)
	hadOld := false
	if _, err := os.Stat(dst); err == nil {
		if err := os.Rename(dst, old); err != nil {
			return err
		}
		hadOld = true
	}
	if err := os.Rename(src, dst); err != nil {
		if hadOld {
			_ = os.Rename(old, dst)
		}
		return err
	}
	return os.Chmod(dst, 0o755)
}

// CleanOld removes what an update left behind next to exe (its .old files or bundle).
func CleanOld(exe string) {
	if b := BundleOf(exe); b != "" {
		os.RemoveAll(b + ".old")
		return
	}
	os.Remove(exe + ".old")
	os.Remove(filepath.Join(filepath.Dir(exe), "monoform-cli.exe.old"))
}

// AfterUpdate handles --after-update=PID (the new version started by the
// old one): it waits for the old process to end (it holds the
// single-instance lock), then removes the old files.
func AfterUpdate(args []string, exe string) {
	for _, a := range args {
		if v, ok := strings.CutPrefix(a, "--after-update="); ok {
			if pid, err := strconv.Atoi(v); err == nil {
				for i := 0; i < 150 && alive(pid); i++ {
					time.Sleep(100 * time.Millisecond)
				}
			}
			CleanOld(exe)
		}
	}
}

func inside(dir, p string) bool {
	rel, err := filepath.Rel(dir, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func extractTarGz(pkg, dir string) error {
	f, err := os.Open(pkg)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		p := filepath.Join(dir, filepath.FromSlash(h.Name))
		if !inside(dir, p) {
			return fmt.Errorf("bad path in package: %s", h.Name)
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(p, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := writeFile(p, tr, os.FileMode(h.Mode)&0o777); err != nil {
				return err
			}
		}
	}
}

// extractZip unpacks a zip, keeping file modes and symlinks (an app bundle has both).
func extractZip(pkg, dir string) error {
	z, err := zip.OpenReader(pkg)
	if err != nil {
		return err
	}
	defer z.Close()
	for _, e := range z.File {
		p := filepath.Join(dir, filepath.FromSlash(e.Name))
		if !inside(dir, p) {
			return fmt.Errorf("bad path in package: %s", e.Name)
		}
		mode := e.Mode()
		switch {
		case mode.IsDir():
			if err := os.MkdirAll(p, 0o755); err != nil {
				return err
			}
		case mode&os.ModeSymlink != 0:
			r, err := e.Open()
			if err != nil {
				return err
			}
			target, err := io.ReadAll(io.LimitReader(r, 4096))
			r.Close()
			if err != nil {
				return err
			}
			if !inside(dir, filepath.Join(filepath.Dir(p), string(target))) {
				return fmt.Errorf("bad link in package: %s", e.Name)
			}
			if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
				return err
			}
			if err := os.Symlink(string(target), p); err != nil {
				return err
			}
		default:
			r, err := e.Open()
			if err != nil {
				return err
			}
			perm := mode.Perm()
			if perm == 0 {
				perm = 0o644
			}
			err = writeFile(p, r, perm)
			r.Close()
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func writeFile(p string, r io.Reader, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm|0o200)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
