//go:build !windows

package setup

import "errors"

// The helpers below only do something on Windows; elsewhere setup runs as a demo.

var errNotWindows = errors.New("only on Windows")

func Elevated() bool                              { return false }
func RunElevated(exe string, args []string) error { return errNotWindows }
func Running(exeName string) bool                 { return false }
func AskToClose(exeName string) error             { return errNotWindows }
func Launch(exe string) error                     { return errNotWindows }
