package app

import (
	"os"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// knownVideos asks Windows for the Videos folder, which may be redirected (OneDrive).
func knownVideos() string {
	d, err := windows.KnownFolderPath(windows.FOLDERID_Videos, 0)
	if err != nil {
		return ""
	}
	return d
}

func setHidden(path string, hidden bool) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return
	}
	attrs, err := windows.GetFileAttributes(p)
	if err != nil {
		return
	}
	if hidden {
		attrs |= windows.FILE_ATTRIBUTE_HIDDEN
	} else {
		attrs &^= windows.FILE_ATTRIBUTE_HIDDEN
	}
	windows.SetFileAttributes(p, attrs)
}

func openMicrophoneSettings() error {
	verb, _ := windows.UTF16PtrFromString("open")
	uri, _ := windows.UTF16PtrFromString("ms-settings:privacy-microphone")
	return windows.ShellExecute(0, verb, uri, nil, nil, windows.SW_SHOWNORMAL)
}

// hideFile hides a recording that is still being written (the dot in its
// name does that elsewhere).
func hideFile(path string)   { setHidden(path, true) }
func unhideFile(path string) { setHidden(path, false) }

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procSetWindowDisplayAffinity = user32.NewProc("SetWindowDisplayAffinity")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
)

// wdaExcludeFromCapture keeps a window out of screen captures (Windows 10
// 2004 and later); older versions show it black, which is still better than
// recording the recorder's own controls.
const (
	wdaNone               = 0x0
	wdaExcludeFromCapture = 0x11
)

// excludeFromCapture keeps this process's windows (the recorder's bar) out
// of screenshots and recordings, or lets them in again.
func excludeFromCapture(on bool) {
	affinity.Lock()
	defer affinity.Unlock()
	affinity.value = wdaNone
	if on {
		affinity.value = wdaExcludeFromCapture
	}
	affinity.cb.Do(func() {
		pid := uint32(os.Getpid())
		affinity.fn = syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
			var owner uint32
			procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&owner)))
			if owner == pid {
				if v, _, _ := procIsWindowVisible.Call(hwnd); v != 0 {
					procSetWindowDisplayAffinity.Call(hwnd, affinity.value)
				}
			}
			return 1
		})
	})
	procEnumWindows.Call(affinity.fn, 0)
}

// affinity is what excludeFromCapture sets; the callback is made once
// (Windows callbacks are a limited resource).
var affinity struct {
	sync.Mutex
	value uintptr
	cb    sync.Once
	fn    uintptr
}
