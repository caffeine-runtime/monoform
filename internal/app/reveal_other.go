//go:build !windows

package app

import "os/exec"

func explorerCommand(p string, isDir bool) *exec.Cmd { return exec.Command("explorer.exe", p) }
