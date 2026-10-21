package app

import "golang.org/x/sys/windows"

// knownDocuments asks Windows for Documents, which may be redirected (OneDrive).
func knownDocuments() string {
	d, err := windows.KnownFolderPath(windows.FOLDERID_Documents, 0)
	if err != nil {
		return ""
	}
	return d
}
