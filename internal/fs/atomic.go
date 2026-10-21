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
func AtomicWrite(path string, fill func(w io.Writer) error) error {
	f, err := CreateAtomic(path)
	if err != nil {
		return err
	}
	if err := fill(f); err != nil {
		f.Abort()
		return err
	}
	return f.Commit()
}

// AtomicFile is a temp file next to its target that replaces the target on
// Commit. Used for chunked uploads where the data arrives over several
// requests.
type AtomicFile struct {
	*os.File
	target string
	perm   iofs.FileMode
	done   bool
}

// CreateAtomic opens a temp file in the target's directory.
func CreateAtomic(path string) (*AtomicFile, error) {
	target, err := resolveTarget(path)
	if err != nil {
		return nil, err
	}
	perm := iofs.FileMode(0o644)
	if st, statErr := os.Stat(target); statErr == nil {
		if st.IsDir() {
			return nil, fmt.Errorf("%s is a directory", target)
		}
		perm = st.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".mf-*.tmp")
	if err != nil {
		return nil, err
	}
	return &AtomicFile{File: tmp, target: target, perm: perm}, nil
}

// Target is the resolved path the file will replace.
func (f *AtomicFile) Target() string { return f.target }

// Commit syncs the temp file and renames it over the target.
func (f *AtomicFile) Commit() (err error) {
	if f.done {
		return errors.New("already committed or aborted")
	}
	f.done = true
	tmpName := f.Name()
	defer func() {
		if err != nil {
			f.File.Close()
			os.Remove(tmpName)
		}
	}()
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.File.Close(); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		if err = os.Chmod(tmpName, f.perm); err != nil {
			return err
		}
	}
	return ReplaceFile(tmpName, f.target)
}

// Versioner keeps the history of files the app replaces: Before sees a file
// just before it is replaced (its content is about to disappear), After the
// file that replaced it.
type Versioner interface {
	Before(path string)
	After(path string)
}

var versioner Versioner

// SetVersioner installs the file history (nil turns it off).
func SetVersioner(v Versioner) { versioner = v }

// ReplaceFile renames a finished temp file over dest, keeping the history of
// dest. Writers that make their own temp file (video, audio) use this too.
func ReplaceFile(tmp, dest string) error {
	v := versioner
	if v != nil {
		v.Before(dest)
	}
	if err := os.Rename(tmp, dest); err != nil {
		return err
	}
	syncDir(filepath.Dir(dest))
	if v != nil {
		v.After(dest)
	}
	return nil
}

// Abort discards the temp file.
func (f *AtomicFile) Abort() {
	if f.done {
		return
	}
	f.done = true
	f.File.Close()
	os.Remove(f.Name())
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
