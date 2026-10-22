//go:build !windows && !darwin

package locale

func system() []string { return fromEnv() }
