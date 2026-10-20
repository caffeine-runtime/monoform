//go:build windows

package imaging

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps a console window from flashing up for the converter.
func hideWindow(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
