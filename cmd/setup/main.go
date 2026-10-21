// Command setup is Monoform's installer and uninstaller for Windows: a
// small Wails window in the app's own look (frontend/setup) around
// internal/setup. The app's files are embedded (payload/, filled by
// scripts/build-setup.sh). On other systems it runs as a demo that installs
// into a test folder, for screenshots and self-tests.
//
//	monoform-setup.exe                 install (or update)
//	monoform-setup.exe --quiet [--dir D] [--everyone] [--desktop] [--defaults] [--no-command]
//	uninstall.exe --uninstall [--quiet] [--remove-data]
package main

import (
	"embed"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// version is set at build time (-X main.version=…).
var version = "0.0.0-dev"

func main() {
	uninstall := flag.Bool("uninstall", false, "remove Monoform")
	quiet := flag.Bool("quiet", false, "no window")
	dir := flag.String("dir", "", "folder to install into")
	everyone := flag.Bool("everyone", false, "install for everyone on this computer")
	desktop := flag.Bool("desktop", false, "add a desktop shortcut")
	defaults := flag.Bool("defaults", false, "make Monoform the default app for its file types")
	noCommand := flag.Bool("no-command", false, "don't add the monoform command")
	removeData := flag.Bool("remove-data", false, "when uninstalling, delete settings and history too")
	demo := flag.Bool("demo", runtime.GOOS != "windows", "install into a test folder, change nothing on this computer")
	flag.Parse()

	s := newSetup(*demo, *uninstall)
	if *quiet {
		var err error
		if *uninstall {
			err = s.Uninstall(*removeData)
		} else {
			o := s.defaultOptions()
			if *dir != "" {
				o.Dir = *dir
			}
			o.Everyone, o.Desktop, o.Defaults, o.Command = *everyone, *desktop, *defaults, !*noCommand
			if *everyone && *dir == "" {
				o.Dir = s.everyoneDir()
			}
			err = s.Install(o)
		}
		if err != nil {
			// A windowless program has no console to show this: also in %TEMP%.
			fmt.Fprintln(os.Stderr, err)
			_ = os.WriteFile(filepath.Join(os.TempDir(), "monoform-setup.log"), []byte(err.Error()+"\n"), 0o644)
			os.Exit(1)
		}
		return
	}

	err := wails.Run(&options.App{
		Title:            "Monoform Setup",
		Width:            580,
		Height:           440,
		DisableResize:    true,
		Frameless:        true,
		BackgroundColour: &options.RGBA{R: 31, G: 30, B: 28, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        s.startup,
		Bind:             []interface{}{s},
		Windows:          &windows.Options{Theme: windows.SystemDefault},
		Linux:            &linux.Options{ProgramName: "monoform-setup"},
	})
	if err != nil {
		log.Fatal(err)
	}
}
