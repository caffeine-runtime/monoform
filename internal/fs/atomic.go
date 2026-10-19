package fs

import (
	"errors"
	"fmt"
	"io"
	iofs "io/fs"
	"os"
	"path/filepath"
	"runtime"
)

// AtomicWriteFile writes data to path so that readers only ever observe the
// old or the new content: the bytes go to a temp file in the same directory,
// which is fsynced and then renamed over the target. Existing permissions are
// kept, and a symlinked target is written through (the link stays a link).
func AtomicWriteFile(path string, data []byte) error {
	return AtomicWrite(path, func(w io.Writer) error {
		_, err := w.Write(data)
		return err
	})
}

// AtomicWriteReader streams r into path atomically.
func AtomicWriteReader(path string, r io.Reader) error {
	return AtomicWrite(path, func(w io.Writer) error {
		_, err := io.Copy(w, r)
		return err
	})
}

// AtomicWrite calls fill with a writer for the temp file and commits the
// result with a rename. If fill fails the target is left untouched.
func AtomicWrite(path string, fill func(w io.Writer) error) (err error) {
	target, err := resolveTarget(path)
	if err != nil {
		return err
	}
	perm := iofs.FileMode(0o644)
	if st, statErr := os.Stat(target); statErr == nil {
		if st.IsDir() {
			return fmt.Errorf("%s is a directory", target)
		}
		perm = st.Mode().Perm()
	}

	dir := filepath.Dir(target)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(target)+".hia-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			tmp.Close()
			os.Remove(tmpName)
		}
	}()

	if err = fill(tmp); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		if err = os.Chmod(tmpName, perm); err != nil {
			return err
		}
	}
	if err = os.Rename(tmpName, target); err != nil {
		return err
	}
	syncDir(dir)
	return nil
}

// resolveTarget follows symlinks so a save replaces the file the link points
// at instead of turning the link into a regular file.
func resolveTarget(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err == nil {
		return resolved, nil
	}
	if errors.Is(err, iofs.ErrNotExist) {
		// New file: resolve the directory only.
		dir, derr := filepath.EvalSymlinks(filepath.Dir(abs))
		if derr != nil {
			return "", derr
		}
		return filepath.Join(dir, filepath.Base(abs)), nil
	}
	return "", err
}

func syncDir(dir string) {
	if runtime.GOOS == "windows" {
		return
	}
	if d, err := os.Open(dir); err == nil {
		d.Sync()
		d.Close()
	}
}
