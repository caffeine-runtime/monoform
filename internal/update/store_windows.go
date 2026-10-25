package update

import (
	"os"
	"syscall"
	"unsafe"
)

var procGetCurrentPackageFullName = syscall.NewLazyDLL("kernel32.dll").NewProc("GetCurrentPackageFullName")

// InStore says this copy runs from an MSIX package (the Microsoft Store
// build): the Store updates it, so it never looks for or installs updates
// itself. MF_STORE_FAKE=1 pretends so (self-tests).
func InStore() bool {
	if os.Getenv("MF_STORE_FAKE") != "" {
		return true
	}
	if procGetCurrentPackageFullName.Find() != nil {
		return false // before Windows 8: no packages
	}
	// Unpackaged processes get APPMODEL_ERROR_NO_PACKAGE (15700); packaged
	// ones ERROR_INSUFFICIENT_BUFFER (122) for this zero-length buffer.
	var n uint32
	r, _, _ := procGetCurrentPackageFullName.Call(uintptr(unsafe.Pointer(&n)), 0)
	return r == 122
}
