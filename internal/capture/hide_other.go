//go:build !windows

package capture

import "os/exec"

func hideWindow(*exec.Cmd) {}
