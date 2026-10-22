//go:build darwin

package locale

import (
	"context"
	"os/exec"
	"regexp"
	"time"
)

var quoted = regexp.MustCompile(`"?([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)"?`)

// system reads the macOS language list (System Settings › Language & Region);
// apps started from Finder have no LANG.
func system() []string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "defaults", "read", "-g", "AppleLanguages").Output()
	var langs []string
	if err == nil {
		for _, m := range quoted.FindAllStringSubmatch(string(out), -1) {
			langs = append(langs, m[1])
		}
	}
	return append(langs, fromEnv()...)
}
