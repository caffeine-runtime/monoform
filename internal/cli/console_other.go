//go:build !windows

package cli

// AttachConsole is only needed on Windows.
func AttachConsole() {}
