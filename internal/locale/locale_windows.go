//go:build windows

package locale

import "golang.org/x/sys/windows"

// system reads the Windows display language list (Settings › Time & language).
func system() []string {
	langs, err := windows.GetUserPreferredUILanguages(windows.MUI_LANGUAGE_NAME)
	if err != nil {
		return fromEnv()
	}
	return langs
}
