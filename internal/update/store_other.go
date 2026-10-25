//go:build !windows

package update

import "os"

// InStore says this copy runs from an MSIX package (the Microsoft Store
// build); only Windows has those. MF_STORE_FAKE=1 pretends so (self-tests).
func InStore() bool { return os.Getenv("MF_STORE_FAKE") != "" }
