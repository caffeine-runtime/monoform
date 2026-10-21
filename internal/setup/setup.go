// Package setup installs and removes Monoform on Windows: the program
// files, Start menu and desktop shortcuts, the monoform command, the "Open
// with" entry, optionally the default-app registrations, the "Quick peek"
// right-click verb and the entry in Settings › Apps. It does what the NSIS
// script (build/windows/installer/project.nsi) did, for the app's own setup
// program (cmd/setup).
//
// Everything goes through a System: the real Windows one (system_windows.go)
// or Record (record.go), which keeps registry and shortcuts in memory and
// writes files under a folder — used by tests and by the demo mode on other
// systems.
package setup

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

const (
	Product   = "Monoform"
	Publisher = "Monoform"
	Exe       = "monoform.exe"
	// CLIExe is the console program behind the monoform command.
	CLIExe = "monoform-cli.exe"
	// UninstallExe is the setup program itself, copied next to the app.
	UninstallExe = "uninstall.exe"
	// keys below Software\ (in HKCU for one user, HKLM for everyone)
	uninstKey = `Microsoft\Windows\CurrentVersion\Uninstall\Monoform`
	stateKey  = `Monoform\Setup`
	// OldExe is the app's executable under its earlier name, Hold It All.
	OldExe      = "hold-it-all.exe"
	peekVerb    = `Classes\*\shell\Monoform.Peek`
	openWithKey = `Classes\Applications\` + Exe
)

// Root is where registry keys live: the current user's or the machine's.
type Root int

const (
	User Root = iota
	Machine
)

func (r Root) String() string {
	if r == Machine {
		return "HKLM"
	}
	return "HKCU"
}

// Folder is a special folder for shortcuts.
type Folder string

const (
	StartMenu Folder = "Programs" // the Start menu's programs, for the user or everyone
	Desktop   Folder = "Desktop"
)

// System is what setup needs from the operating system.
type System interface {
	WriteFile(path string, r io.Reader) error
	RemoveAll(path string) error
	SetString(root Root, key, name, value string) error
	SetDWord(root Root, key, name string, value uint32) error
	// GetString returns ok=false if the value or key doesn't exist.
	GetString(root Root, key, name string) (string, bool)
	DeleteValue(root Root, key, name string) error
	DeleteKey(root Root, key string) error // with its subkeys
	Shortcut(root Root, folder Folder, name, target, args string) error
	RemoveShortcut(root Root, folder Folder, name string) error
	// CommandShim writes (or with an empty body removes) a script in a folder on the user's PATH.
	CommandShim(name, body string) error
	// AssocChanged tells Explorer that file associations changed.
	AssocChanged()
}

// Assoc is a file type the app opens (from wails.json).
type Assoc struct {
	Ext, ProgID, Description string
	// Icon names the type's document icon, <Icon>.ico in the install folder.
	Icon string
}

// Icons are the document icon files the file types use (installed with the app).
func Icons(assocs []Assoc) []string {
	var out []string
	seen := map[string]bool{}
	for _, a := range assocs {
		if a.Icon != "" && !seen[a.Icon] {
			seen[a.Icon] = true
			out = append(out, a.Icon+".ico")
		}
	}
	return out
}

// quickView are the types that open in a quick-view window (no session,
// panels or tools until Edit): pictures, like the system's photo viewer.
var quickView = map[string]bool{"png": true, "jpg": true, "jpeg": true, "gif": true, "webp": true, "bmp": true, "svg": true}

// Options are the user's choices.
type Options struct {
	Dir      string `json:"dir"`
	Everyone bool   `json:"everyone"` // install for all users (Program Files, HKLM)
	Desktop  bool   `json:"desktop"`
	Defaults bool   `json:"defaults"` // make the app the default for its file types
	Command  bool   `json:"command"`  // monoform on PATH
	Version  string `json:"version"`
}

func (o Options) root() Root {
	if o.Everyone {
		return Machine
	}
	return User
}

// File is one file of the payload.
type File struct {
	Name string
	Size int64
	Open func() (io.ReadCloser, error)
}

// Progress reports a step and how many bytes of the payload are written.
type Progress func(step string, done, total int64)

// Install puts the app in place. self is the setup program (copied as the uninstaller).
func Install(sys System, files []File, self File, o Options, assocs []Assoc, progress Progress) error {
	if o.Dir == "" {
		return errors.New("no folder to install into")
	}
	if progress == nil {
		progress = func(string, int64, int64) {}
	}
	root := o.root()
	var total, done int64
	for _, f := range append(files, self) {
		total += f.Size
	}
	for _, f := range append(files, self) {
		name := f.Name
		if f.Name == self.Name {
			name = UninstallExe
		}
		progress("Copying "+name, done, total)
		if err := copyFile(sys, join(o.Dir, name), f); err != nil {
			return fmt.Errorf("copying %s: %w", name, err)
		}
		done += f.Size
	}
	exe := join(o.Dir, Exe)
	progress("Adding shortcuts", done, total)
	if err := sys.Shortcut(root, StartMenu, Product, exe, ""); err != nil {
		return err
	}
	if o.Desktop {
		if err := sys.Shortcut(root, Desktop, Product, exe, ""); err != nil {
			return err
		}
	}
	if o.Command {
		if err := sys.CommandShim("monoform.cmd", fmt.Sprintf("@\"%s\" %%*\r\n", join(o.Dir, CLIExe))); err != nil {
			return err
		}
	}
	progress("Registering file types", done, total)
	for _, w := range registrations(o, assocs) {
		if err := sys.SetString(root, w.key, w.name, w.value); err != nil {
			return err
		}
	}
	if o.Defaults {
		for _, a := range assocs {
			key := `Classes\.` + a.Ext
			if prev, ok := sys.GetString(root, key, ""); ok && prev != a.ProgID {
				if err := sys.SetString(root, key, a.ProgID+"_backup", prev); err != nil {
					return err
				}
			}
			if err := sys.SetString(root, key, "", a.ProgID); err != nil {
				return err
			}
		}
		sys.AssocChanged()
	}
	progress("Finishing", done, total)
	for _, w := range uninstallEntry(o, total) {
		if w.dword {
			if err := sys.SetDWord(root, w.key, w.name, uint32(w.n)); err != nil {
				return err
			}
		} else if err := sys.SetString(root, w.key, w.name, w.value); err != nil {
			return err
		}
	}
	progress("Done", total, total)
	return nil
}

func copyFile(sys System, dst string, f File) error {
	r, err := f.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	return sys.WriteFile(dst, r)
}

type regWrite struct {
	key, name, value string
	dword            bool
	n                int64
}

// registrations: "Open with", the Quick peek verb and (always, so that
// choosing the app as default later shows its icon and name) the file classes.
func registrations(o Options, assocs []Assoc) []regWrite {
	exe := join(o.Dir, Exe)
	open := fmt.Sprintf(`"%s" "%%1"`, exe)
	peek := fmt.Sprintf(`"%s" --peek "%%1"`, exe)
	w := []regWrite{
		{key: openWithKey, name: "FriendlyAppName", value: Product},
		{key: openWithKey + `\shell\open\command`, value: open},
		{key: peekVerb, value: "Quick peek with " + Product},
		{key: peekVerb, name: "Icon", value: fmt.Sprintf(`"%s"`, exe)},
		{key: peekVerb + `\command`, value: peek},
	}
	for _, a := range assocs {
		icon := join(o.Dir, a.Icon+".ico")
		if a.Icon == "" {
			icon = fmt.Sprintf(`"%s",0`, exe)
		}
		cmd := open
		if quickView[a.Ext] {
			cmd = peek
		}
		w = append(w,
			regWrite{key: openWithKey + `\SupportedTypes`, name: "." + a.Ext},
			regWrite{key: `Classes\` + a.ProgID, value: a.Description},
			regWrite{key: `Classes\` + a.ProgID + `\DefaultIcon`, value: icon},
			regWrite{key: `Classes\` + a.ProgID + `\shell`, value: "open"},
			regWrite{key: `Classes\` + a.ProgID + `\shell\open`, value: "Open with " + Product},
			regWrite{key: `Classes\` + a.ProgID + `\shell\open\command`, value: cmd},
			regWrite{key: `Classes\.` + a.Ext + `\OpenWithProgids`, name: a.ProgID},
		)
		if quickView[a.Ext] {
			// The editor stays a right-click away.
			w = append(w,
				regWrite{key: `Classes\` + a.ProgID + `\shell\edit`, value: "Edit with " + Product},
				regWrite{key: `Classes\` + a.ProgID + `\shell\edit\command`, value: open},
			)
		}
	}
	return w
}

func uninstallEntry(o Options, size int64) []regWrite {
	un := join(o.Dir, UninstallExe)
	scope := "user"
	if o.Everyone {
		scope = "everyone"
	}
	defaults := "0"
	if o.Defaults {
		defaults = "1"
	}
	return []regWrite{
		{key: uninstKey, name: "DisplayName", value: Product},
		{key: uninstKey, name: "DisplayVersion", value: o.Version},
		{key: uninstKey, name: "Publisher", value: Publisher},
		{key: uninstKey, name: "DisplayIcon", value: join(o.Dir, Exe)},
		{key: uninstKey, name: "InstallLocation", value: o.Dir},
		{key: uninstKey, name: "UninstallString", value: fmt.Sprintf(`"%s" --uninstall`, un)},
		{key: uninstKey, name: "QuietUninstallString", value: fmt.Sprintf(`"%s" --uninstall --quiet`, un)},
		{key: uninstKey, name: "EstimatedSize", dword: true, n: (size + 1023) / 1024},
		{key: uninstKey, name: "NoModify", dword: true, n: 1},
		{key: uninstKey, name: "NoRepair", dword: true, n: 1},
		{key: stateKey, name: "Dir", value: o.Dir},
		{key: stateKey, name: "Scope", value: scope},
		{key: stateKey, name: "Defaults", value: defaults},
		{key: stateKey, name: "Desktop", value: boolStr(o.Desktop)},
		{key: stateKey, name: "Command", value: boolStr(o.Command)},
		{key: stateKey, name: "Version", value: o.Version},
	}
}

// join puts a file name in a folder with the folder's own separator (paths
// are Windows paths even when tests and the demo mode run elsewhere).
func join(dir, name string) string {
	if strings.Contains(dir, `\`) {
		return strings.TrimRight(dir, `\`) + `\` + name
	}
	return filepath.Join(dir, name)
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

// Installed is an existing installation found in the registry.
type Installed struct {
	Dir      string `json:"dir"`
	Version  string `json:"version"`
	Everyone bool   `json:"everyone"`
	Defaults bool   `json:"defaults"`
	Desktop  bool   `json:"desktop"`
	Command  bool   `json:"command"`
}

// Find looks for an installation made by this setup (the user's first).
func Find(sys System) (Installed, bool) {
	for _, root := range []Root{User, Machine} {
		dir, ok := sys.GetString(root, stateKey, "Dir")
		if !ok || dir == "" {
			continue
		}
		get := func(name string) string { v, _ := sys.GetString(root, stateKey, name); return v }
		return Installed{Dir: dir, Version: get("Version"), Everyone: root == Machine, Defaults: get("Defaults") == "1", Desktop: get("Desktop") == "1", Command: get("Command") == "1"}, true
	}
	return Installed{}, false
}

// OldInstall is an installation by the earlier NSIS installer.
type OldInstall struct {
	Uninstall string `json:"uninstall"` // its quiet uninstall command
	Everyone  bool   `json:"everyone"`
	Key       string `json:"-"`
}

// OldUninstKeys are earlier installs, under the app's earlier name (Hold It
// All): its own setup's entry (2.0 betas), then the NSIS installer's
// (company + product name). One found is removed before installing; the
// user's settings and history are kept (the app moves them to its new
// folder on first start).
var OldUninstKeys = []string{
	`Microsoft\Windows\CurrentVersion\Uninstall\HoldItAll`,
	`Microsoft\Windows\CurrentVersion\Uninstall\Hold It AllHold It All`,
}

// FindOld looks for an earlier install.
func FindOld(sys System) (OldInstall, bool) {
	for _, key := range OldUninstKeys {
		for _, root := range []Root{Machine, User} {
			if q, ok := sys.GetString(root, key, "QuietUninstallString"); ok && q != "" {
				return OldInstall{Uninstall: q, Everyone: root == Machine, Key: key}, true
			}
			// NSIS: /S is its silent switch.
			if u, ok := sys.GetString(root, key, "UninstallString"); ok && u != "" {
				return OldInstall{Uninstall: strings.TrimSpace(u) + " /S", Everyone: root == Machine, Key: key}, true
			}
		}
	}
	return OldInstall{}, false
}

// Uninstall removes what Install added (the user's own files and settings stay).
func Uninstall(sys System, in Installed, assocs []Assoc, progress Progress) error {
	if progress == nil {
		progress = func(string, int64, int64) {}
	}
	root := User
	if in.Everyone {
		root = Machine
	}
	progress("Removing shortcuts", 0, 3)
	_ = sys.RemoveShortcut(root, StartMenu, Product)
	_ = sys.RemoveShortcut(root, Desktop, Product)
	if in.Command {
		_ = sys.CommandShim("monoform.cmd", "")
	}
	progress("Removing file types", 1, 3)
	for _, a := range assocs {
		key := `Classes\.` + a.Ext
		if cur, ok := sys.GetString(root, key, ""); ok && cur == a.ProgID {
			// Give the type back to what had it before (or nothing).
			if prev, ok := sys.GetString(root, key, a.ProgID+"_backup"); ok && prev != "" {
				_ = sys.SetString(root, key, "", prev)
			} else {
				_ = sys.DeleteValue(root, key, "")
			}
		}
		_ = sys.DeleteValue(root, key, a.ProgID+"_backup")
		_ = sys.DeleteValue(root, key+`\OpenWithProgids`, a.ProgID)
		_ = sys.DeleteKey(root, `Classes\`+a.ProgID)
	}
	_ = sys.DeleteKey(root, openWithKey)
	_ = sys.DeleteKey(root, `Classes\*\shell\Monoform.Peek`)
	if in.Defaults {
		sys.AssocChanged()
	}
	progress("Removing files", 2, 3)
	if in.Dir != "" {
		if err := sys.RemoveAll(in.Dir); err != nil {
			return fmt.Errorf("removing %s: %w", in.Dir, err)
		}
	}
	_ = sys.DeleteKey(root, uninstKey)
	_ = sys.DeleteKey(root, stateKey)
	progress("Done", 3, 3)
	return nil
}
