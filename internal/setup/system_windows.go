//go:build windows

package setup

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Windows is the real System.
type Windows struct{}

func hive(root Root) registry.Key {
	if root == Machine {
		return registry.LOCAL_MACHINE
	}
	return registry.CURRENT_USER
}

func soft(key string) string { return `Software\` + key }

func (Windows) WriteFile(path string, r io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".new"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (Windows) RemoveAll(path string) error { return os.RemoveAll(path) }

func (Windows) SetString(root Root, key, name, value string) error {
	k, _, err := registry.CreateKey(hive(root), soft(key), registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf(`%s\%s: %w`, root, key, err)
	}
	defer k.Close()
	return k.SetStringValue(name, value)
}

func (Windows) SetDWord(root Root, key, name string, value uint32) error {
	k, _, err := registry.CreateKey(hive(root), soft(key), registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetDWordValue(name, value)
}

func (Windows) GetString(root Root, key, name string) (string, bool) {
	k, err := registry.OpenKey(hive(root), soft(key), registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer k.Close()
	v, _, err := k.GetStringValue(name)
	return v, err == nil
}

func (Windows) DeleteValue(root Root, key, name string) error {
	k, err := registry.OpenKey(hive(root), soft(key), registry.SET_VALUE)
	if err != nil {
		return nil
	}
	defer k.Close()
	if err := k.DeleteValue(name); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

func (Windows) DeleteKey(root Root, key string) error { return deleteTree(hive(root), soft(key)) }

func deleteTree(h registry.Key, path string) error {
	k, err := registry.OpenKey(h, path, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return nil // already gone
	}
	subs, _ := k.ReadSubKeyNames(-1)
	k.Close()
	for _, s := range subs {
		if err := deleteTree(h, path+`\`+s); err != nil {
			return err
		}
	}
	return registry.DeleteKey(h, path)
}

// specialFolder names a folder for [Environment]::GetFolderPath.
func specialFolder(root Root, f Folder) string {
	if root == Machine {
		if f == Desktop {
			return "CommonDesktopDirectory"
		}
		return "CommonPrograms"
	}
	return string(f)
}

func (Windows) Shortcut(root Root, folder Folder, name, target, args string) error {
	// .lnk files are COM objects; PowerShell's WScript.Shell writes them without cgo.
	script := fmt.Sprintf(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('%s')) '%s.lnk'));$s.TargetPath='%s';$s.Arguments='%s';$s.WorkingDirectory='%s';$s.IconLocation='%s,0';$s.Save()`,
		specialFolder(root, folder), ps(name), ps(target), ps(args), ps(filepath.Dir(target)), ps(target))
	return powershell(script)
}

func (Windows) RemoveShortcut(root Root, folder Folder, name string) error {
	return powershell(fmt.Sprintf(`Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('%s')) '%s.lnk') -ErrorAction SilentlyContinue`, specialFolder(root, folder), ps(name)))
}

func ps(s string) string { return strings.ReplaceAll(s, "'", "''") }

func powershell(script string) error {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (Windows) CommandShim(name, body string) error {
	dir := filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WindowsApps")
	p := filepath.Join(dir, name)
	if body == "" {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte(body), 0o644)
}

var shChangeNotify = windows.NewLazySystemDLL("shell32.dll").NewProc("SHChangeNotify")

func (Windows) AssocChanged() {
	const SHCNE_ASSOCCHANGED = 0x08000000
	shChangeNotify.Call(SHCNE_ASSOCCHANGED, 0, 0, 0)
}

// ---- helpers for the setup program ----

// Elevated reports whether this process runs as administrator.
func Elevated() bool { return windows.GetCurrentProcessToken().IsElevated() }

// RunElevated starts exe with args as administrator (Windows asks the user) and waits for it.
func RunElevated(exe string, args []string) error {
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = "'" + ps(a) + "'"
	}
	list := ""
	if len(args) > 0 {
		list = " -ArgumentList " + strings.Join(quoted, ",")
	}
	return powershell(fmt.Sprintf(`$p=Start-Process -FilePath '%s'%s -Verb RunAs -Wait -PassThru; exit $p.ExitCode`, ps(exe), list))
}

// RunCommandLine runs a whole command line (an uninstall string) elevated and waits.
func RunCommandLine(line string, elevated bool) error {
	exe, args := splitCommand(line)
	if elevated {
		return RunElevated(exe, args)
	}
	cmd := exec.Command(exe, args...)
	return cmd.Run()
}

// splitCommand splits `"C:\a b\x.exe" /S` into the program and its arguments.
func splitCommand(line string) (string, []string) {
	line = strings.TrimSpace(line)
	if strings.HasPrefix(line, `"`) {
		if i := strings.Index(line[1:], `"`); i >= 0 {
			return line[1 : i+1], strings.Fields(line[i+2:])
		}
	}
	f := strings.Fields(line)
	if len(f) == 0 {
		return "", nil
	}
	return f[0], f[1:]
}

// Running reports whether a process with this file name runs (for any user session we can see).
func Running(exeName string) bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		if strings.EqualFold(windows.UTF16ToString(e.ExeFile[:]), exeName) {
			return true
		}
	}
	return false
}

// AskToClose asks a running app to close, as clicking its close button would
// (it may ask about unsaved changes).
func AskToClose(exeName string) error {
	cmd := exec.Command("taskkill.exe", "/IM", exeName)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	return cmd.Run()
}

// Launch starts the app as the signed-in user (through Explorer, so not as
// administrator even when setup runs elevated).
func Launch(exe string) error {
	return exec.Command("explorer.exe", exe).Start()
}
