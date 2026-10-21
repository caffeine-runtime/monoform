package app

import (
	"os/exec"
	"syscall"
)

// explorerCommand opens Explorer at dir, or with the file selected. Explorer
// parses its own command line ("/select," followed by the quoted path), which
// Go's argument quoting would break, so the line is given as is.
func explorerCommand(p string, isDir bool) *exec.Cmd {
	cmd := exec.Command("explorer.exe")
	line := `explorer.exe "` + p + `"`
	if !isDir {
		line = `explorer.exe /select,"` + p + `"`
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: line}
	return cmd
}
