package ai

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

func openLibrary(path string) (uintptr, error) {
	// The DLL's own folder first, never the current directory.
	h, err := windows.LoadLibraryEx(path, 0, windows.LOAD_WITH_ALTERED_SEARCH_PATH)
	if err != nil {
		return 0, err
	}
	return windows.GetProcAddress(h, "OrtGetApiBase")
}

// pathString is a model path as ONNX Runtime takes it on Windows (wchar_t*).
type pathString []uint16

func pathArg(p string) pathString {
	s, err := windows.UTF16FromString(p)
	if err != nil {
		return []uint16{0}
	}
	return s
}

func (p pathString) ptr() uintptr { return uintptr(unsafe.Pointer(&p[0])) }
