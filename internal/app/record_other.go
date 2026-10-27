//go:build !windows

package app

import "errors"

func knownVideos() string { return "" }

func openMicrophoneSettings() error { return errors.New("not available on this system") }

func hideFile(string)   {}
func unhideFile(string) {}

// excludeFromCapture is Windows-only (recording is offered there first).
func excludeFromCapture(bool) {}
