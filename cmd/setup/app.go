package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/caffeine-runtime/monoform/internal/setup"
)

// Setup is bound to the window (window.go.main.Setup).
type Setup struct {
	ctx      context.Context
	sys      setup.System
	rec      *setup.Record // the demo's stand-in system (nil on Windows)
	demo     bool
	mode     string
	demoRoot string
}

func newSetup(demo, uninstall bool) *Setup {
	s := &Setup{demo: demo, mode: "install"}
	if uninstall {
		s.mode = "uninstall"
	}
	if demo {
		s.demoRoot = os.Getenv("MF_SETUP_DEMO_DIR")
		if s.demoRoot == "" {
			s.demoRoot = filepath.Join(os.TempDir(), "monoform-setup-demo")
		}
		s.rec = setup.NewRecord(s.demoRoot)
		_ = s.rec.Load(filepath.Join(s.demoRoot, "registry.json"))
		s.sys = s.rec
	} else {
		s.sys = system()
	}
	return s
}

func (s *Setup) startup(ctx context.Context) { s.ctx = ctx }

// Info is what the window shows first.
type Info struct {
	Mode        string           `json:"mode"`
	Version     string           `json:"version"`
	UserDir     string           `json:"userDir"`
	EveryoneDir string           `json:"everyoneDir"`
	Installed   *setup.Installed `json:"installed"`
	Running     bool             `json:"running"`
	Demo        bool             `json:"demo"`
	Test        bool             `json:"test"`
}

func (s *Setup) Info() Info {
	i := Info{Mode: s.mode, Version: version, UserDir: s.userDir(), EveryoneDir: s.everyoneDir(), Demo: s.demo, Test: os.Getenv("MF_SETUP_TEST") != ""}
	if in, ok := setup.Find(s.sys); ok {
		i.Installed = &in
	}
	i.Running = !s.demo && setup.Running(setup.Exe)
	return i
}

func (s *Setup) userDir() string {
	if s.demo {
		return filepath.Join(s.demoRoot, "Users", "you", "AppData", "Local", "Programs", setup.Product)
	}
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", setup.Product)
}

func (s *Setup) everyoneDir() string {
	if s.demo {
		return filepath.Join(s.demoRoot, "Program Files", setup.Product)
	}
	pf := os.Getenv("ProgramW6432")
	if pf == "" {
		pf = os.Getenv("ProgramFiles")
	}
	return filepath.Join(pf, setup.Product)
}

func (s *Setup) defaultOptions() setup.Options {
	o := setup.Options{Dir: s.userDir(), Command: true, Version: version}
	if in, ok := setup.Find(s.sys); ok {
		o.Dir, o.Everyone, o.Desktop, o.Defaults, o.Command = in.Dir, in.Everyone, in.Desktop, in.Defaults, in.Command
	}
	return o
}

func (s *Setup) Browse(dir string) (string, error) {
	return wruntime.OpenDirectoryDialog(s.ctx, wruntime.OpenDialogOptions{Title: "Install Monoform into", DefaultDirectory: filepath.Dir(dir)})
}

func (s *Setup) Log(msg string) { log.Print(msg) }

func (s *Setup) progress(step string, done, total int64) {
	if s.ctx != nil {
		wruntime.EventsEmit(s.ctx, "progress", map[string]any{"step": step, "done": done, "total": total})
	} else {
		log.Printf("%3d%% %s", done*100/max(total, 1), step)
	}
}

// self is this program, copied next to the app as its uninstaller.
func self() (setup.File, error) {
	exe, err := os.Executable()
	if err != nil {
		return setup.File{}, err
	}
	st, err := os.Stat(exe)
	if err != nil {
		return setup.File{}, err
	}
	return setup.File{Name: filepath.Base(exe), Size: st.Size(), Open: func() (io.ReadCloser, error) { return os.Open(exe) }}, nil
}

// Install installs (or updates) with the window's choices.
func (s *Setup) Install(o setup.Options) error {
	if o.Version == "" {
		o.Version = version
	}
	o.Dir = strings.TrimSpace(o.Dir)
	if !s.demo && o.Everyone && !setup.Elevated() {
		// For everyone needs an administrator: the same program does it, elevated and quiet.
		s.progress("Waiting for permission…", 0, 1)
		exe, _ := os.Executable()
		args := []string{"--quiet", "--everyone", "--dir", o.Dir}
		if o.Desktop {
			args = append(args, "--desktop")
		}
		if o.Defaults {
			args = append(args, "--defaults")
		}
		if !o.Command {
			args = append(args, "--no-command")
		}
		if err := setup.RunElevated(exe, args); err != nil {
			return errors.New("installing for everyone needs an administrator's permission; it was not given or the installation failed")
		}
		s.progress("Done", 1, 1)
		return nil
	}
	if !s.demo && setup.Running(setup.Exe) {
		return errors.New("Monoform is open — close it, then try again")
	}
	me, err := self()
	if err != nil {
		return err
	}
	err = setup.Install(s.sys, payloadFiles(), me, o, setup.Assocs, s.progress)
	s.saveDemo()
	return err
}

// Update installs this version over the installed one, keeping its folder and
// choices (for everyone, desktop shortcut, default app, command), once the
// running app — which started this and is closing — has exited; then starts it.
func (s *Setup) Update() error {
	for i := 0; i < 240 && !s.demo && setup.Running(setup.Exe); i++ {
		time.Sleep(250 * time.Millisecond)
	}
	if err := s.Install(s.defaultOptions()); err != nil {
		return err
	}
	return s.Launch()
}

// Uninstall removes the app (and with removeData its settings, history and index).
func (s *Setup) Uninstall(removeData bool) error {
	in, ok := setup.Find(s.sys)
	if !ok {
		exe, _ := os.Executable()
		in = setup.Installed{Dir: filepath.Dir(exe)}
	}
	if !s.demo && in.Everyone && !setup.Elevated() {
		exe, _ := os.Executable()
		args := []string{"--uninstall", "--quiet"}
		if removeData {
			args = append(args, "--remove-data")
		}
		s.progress("Waiting for permission…", 0, 1)
		if err := setup.RunElevated(exe, args); err != nil {
			return errors.New("removing it for everyone needs an administrator's permission")
		}
		return nil
	}
	if !s.demo && setup.Running(setup.Exe) {
		return errors.New("Monoform is open — close it, then try again")
	}
	sys := s.sys
	moved := ""
	if !s.demo {
		moved = moveSelfOut(in.Dir)
		if moved == "" {
			// It couldn't move (the temp folder is on another drive): remove
			// everything but itself now, itself and the folder once it exits.
			if exe, err := os.Executable(); err == nil && inside(in.Dir, exe) {
				moved = exe
				sys = keepRunning{sys, exe}
			}
		}
	}
	if err := setup.Uninstall(sys, in, setup.Assocs, s.progress); err != nil {
		return err
	}
	if !s.demo {
		// The web view's cache always; the user's own data only when asked.
		if d, err := os.UserConfigDir(); err == nil {
			os.RemoveAll(filepath.Join(d, setup.Exe))
			if removeData {
				os.RemoveAll(filepath.Join(d, "Monoform"))
			}
		}
		if d, err := os.UserCacheDir(); err == nil && removeData {
			os.RemoveAll(filepath.Join(d, "Monoform"))
		}
		scheduleSelfDelete(moved, in.Dir)
	}
	s.saveDemo()
	return nil
}

func (s *Setup) saveDemo() {
	if s.rec != nil {
		_ = s.rec.Save(filepath.Join(s.demoRoot, "registry.json"))
	}
}

// CloseApp asks a running Monoform to close and waits up to 20 s (it may ask about unsaved work).
func (s *Setup) CloseApp() bool {
	if s.demo {
		return true
	}
	_ = setup.AskToClose(setup.Exe)
	for i := 0; i < 80; i++ {
		if !setup.Running(setup.Exe) {
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}
	return false
}

// Launch opens the installed app.
func (s *Setup) Launch() error {
	in, ok := setup.Find(s.sys)
	if !ok {
		return errors.New("not installed")
	}
	if s.demo {
		log.Printf("demo: would start %s", filepath.Join(in.Dir, setup.Exe))
		return nil
	}
	return setup.Launch(filepath.Join(in.Dir, setup.Exe))
}

// moveSelfOut: the uninstaller lives in the folder it removes, and Windows
// can't delete a running program — but it can move it. It goes to the temp
// folder (deleted after it exits, see scheduleSelfDelete).
func moveSelfOut(dir string) string {
	exe, err := os.Executable()
	if err != nil || runtime.GOOS != "windows" {
		return ""
	}
	if !inside(dir, exe) {
		return ""
	}
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("monoform-uninstall-%d.exe", os.Getpid()))
	if err := os.Rename(exe, tmp); err != nil {
		return ""
	}
	return tmp
}

func inside(dir, p string) bool {
	rel, err := filepath.Rel(dir, p)
	return err == nil && rel != "." && !strings.HasPrefix(rel, "..")
}

// keepRunning removes a folder except the running uninstaller in it.
type keepRunning struct {
	setup.System
	self string
}

func (k keepRunning) RemoveAll(dir string) error {
	if !inside(dir, k.self) {
		return k.System.RemoveAll(dir)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		if strings.EqualFold(p, k.self) {
			continue
		}
		if err := k.System.RemoveAll(p); err != nil {
			return err
		}
	}
	return nil
}

// scheduleSelfDelete removes the moved uninstaller once it has exited (and
// the install folder, in case something kept it).
func scheduleSelfDelete(exe, dir string) {
	if runtime.GOOS != "windows" || exe == "" {
		return
	}
	// cmd.exe gets this line as is (Go's argument quoting would escape the quotes in a way cmd doesn't read).
	_ = startRaw("cmd.exe", fmt.Sprintf(`cmd.exe /D /C "ping 127.0.0.1 -n 3 > nul & del /f /q "%s" & if exist "%s" rmdir /s /q "%s""`, exe, dir, dir))
}
