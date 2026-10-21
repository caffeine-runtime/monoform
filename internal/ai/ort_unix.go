//go:build !windows

package ai

import (
	"unsafe"

	"github.com/ebitengine/purego"
)

func openLibrary(path string) (uintptr, error) {
	h, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_LOCAL)
	if err != nil {
		return 0, err
	}
	return purego.Dlsym(h, "OrtGetApiBase")
}

// pathString is a model path as ONNX Runtime takes it (char* here).
type pathString []byte

func pathArg(p string) pathString { return cstr(p) }

func (p pathString) ptr() uintptr { return uintptr(unsafe.Pointer(&p[0])) }
