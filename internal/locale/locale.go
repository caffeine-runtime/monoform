// Package locale finds the languages the user's system is set to, most
// preferred first, as BCP 47 tags ("pl-PL", "es-ES", "en-US"). The
// frontend picks the interface language from them when the user hasn't
// chosen one. MF_SYSTEM_LANG overrides it (self-tests).
package locale

import (
	"os"
	"strings"
)

// Languages returns the system's preferred languages (may be empty).
func Languages() []string {
	if v := os.Getenv("MF_SYSTEM_LANG"); v != "" {
		return normalizeAll(strings.Split(v, ","))
	}
	return normalizeAll(system())
}

// fromEnv reads the POSIX locale variables (LANGUAGE is a priority list).
func fromEnv() []string {
	var out []string
	if v := os.Getenv("LANGUAGE"); v != "" {
		out = append(out, strings.Split(v, ":")...)
	}
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if v := os.Getenv(k); v != "" {
			out = append(out, v)
			break
		}
	}
	return out
}

// Normalize turns "pl_PL.UTF-8@euro" or "es-419" into a BCP 47 tag ("pl-PL", "es-419"); "" for C/POSIX.
func Normalize(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, ".@"); i >= 0 {
		s = s[:i]
	}
	s = strings.ReplaceAll(s, "_", "-")
	if s == "" || s == "C" || s == "POSIX" {
		return ""
	}
	parts := strings.Split(s, "-")
	parts[0] = strings.ToLower(parts[0])
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) == 2 {
			parts[i] = strings.ToUpper(parts[i])
		}
	}
	return strings.Join(parts, "-")
}

func normalizeAll(in []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, s := range in {
		if n := Normalize(s); n != "" && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	return out
}
