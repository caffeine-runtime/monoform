//go:build !windows

package update

import "syscall"

// alive reports whether process pid still runs.
func alive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
