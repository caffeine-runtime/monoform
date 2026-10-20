//go:build !windows

package imaging

import "os/exec"

func hideWindow(*exec.Cmd) {}
