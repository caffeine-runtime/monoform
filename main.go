package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"github.com/caffeine-runtime/monoform/internal/app"
	"github.com/caffeine-runtime/monoform/internal/cli"
	"github.com/caffeine-runtime/monoform/internal/update"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

var processStart = time.Now()

func main() {
	// monoform hash / verify / info / convert … run without a window.
	if cli.IsCommand(os.Args[1:]) {
		cli.AttachConsole()
		code, _ := cli.Main(os.Args[1:], app.Version, os.Stdout, os.Stderr)
		os.Exit(code)
	}
	// Started by an update: wait for the old version to close, remove its leftovers.
	if exe, err := os.Executable(); err == nil {
		update.AfterUpdate(os.Args[1:], exe)
		update.CleanOld(exe)
	}
	wd, _ := os.Getwd()
	files, mode := parseLaunch(os.Args[1:], wd)
	a := app.New(processStart, files, mode)
	if x, y, ok := parseAt(os.Args[1:]); ok {
		a.SetStartPosition(x, y)
	}
	width, height := 1280, 820
	switch mode {
	case "peek":
		// Quick peek: a small window; "Open in editor" makes it full size.
		width, height = 960, 680
	case "window":
		// A tab moved out: a little smaller than the main window, so both fit.
		width, height = 1100, 720
	case "convert":
		// Convert with Monoform (a file manager's right-click menu): just the format dialog.
		width, height = 560, 640
	}
	minW, minH, title := 640, 400, "Monoform"
	if mode == "convert" {
		minW, minH, title = 420, 420, "Convert with Monoform"
	}
	if dist, err := fs.Sub(assets, "frontend/dist"); err == nil {
		a.Assets = dist
	}

	err := wails.Run(&options.App{
		Title:            title,
		Width:            width,
		Height:           height,
		MinWidth:         minW,
		MinHeight:        minH,
		BackgroundColour: &options.RGBA{R: 31, G: 30, B: 28, A: 255},
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: a.Server.Middleware,
		},
		OnStartup:     a.Startup,
		OnShutdown:    a.Shutdown,
		OnBeforeClose: a.BeforeClose,
		Bind:          []interface{}{a},
		// One app per user: later launches hand their files to it — except a
		// window a tab was moved to (--new-window) and a quick peek (--peek).
		SingleInstanceLock: singleInstance(mode, func(d options.SecondInstanceData) {
			files, mode := parseLaunch(d.Args, d.WorkingDirectory)
			a.OpenFilesMode(files, mode)
		}),
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			About:    &mac.AboutInfo{Title: "Monoform", Message: "One window for your everyday files.", Icon: icon},
			OnFileOpen: func(path string) {
				a.OpenFiles([]string{path})
			},
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			Theme:                windows.SystemDefault,
		},
		Linux: &linux.Options{
			Icon:             icon,
			ProgramName:      "monoform",
			WebviewGpuPolicy: linux.WebviewGpuPolicyOnDemand,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

func singleInstance(mode string, onLaunch func(options.SecondInstanceData)) *options.SingleInstanceLock {
	// A moved-out tab's window and quick peeks are processes of their own:
	// double-clicking pictures opens a light viewer each, not the editor.
	if mode == "window" || mode == "peek" {
		return nil
	}
	// A self-test runs on its own: handed to a copy that is already open, it
	// would exit at once with success.
	if os.Getenv("MF_TEST") != "" {
		return nil
	}
	// Converting: a file manager starts one process per selected file; the
	// first window gathers the others' files (and leaves the editor alone).
	if mode == "convert" {
		return &options.SingleInstanceLock{UniqueId: "dev.monoform.convert", OnSecondInstanceLaunch: onLaunch}
	}
	return &options.SingleInstanceLock{UniqueId: "dev.monoform.app", OnSecondInstanceLaunch: onLaunch}
}

// parseAt reads --at=X,Y: where (screen pixels) a window a tab was dragged
// out to should appear.
func parseAt(args []string) (int, int, bool) {
	for _, a := range args {
		if v, ok := strings.CutPrefix(a, "--at="); ok {
			var x, y int
			if _, err := fmt.Sscanf(v, "%d,%d", &x, &y); err == nil {
				return x, y, true
			}
		}
	}
	return 0, 0, false
}

// parseLaunch splits the command line into files to open (existing paths,
// made absolute) and the mode: "peek" (--peek), "preview" (--preview),
// "convert" (--convert), "window" (--new-window: a tab moved to a window of
// its own) or "".
func parseLaunch(args []string, wd string) ([]string, string) {
	mode := ""
	var rest []string
	for _, a := range args {
		switch a {
		case "--peek":
			mode = "peek"
		case "--preview":
			if mode == "" {
				mode = "preview"
			}
		case "--new-window":
			mode = "window"
		case "--convert":
			mode = "convert"
		default:
			if !strings.HasPrefix(a, "-") { // ignore other flags (macOS adds -psn_…)
				rest = append(rest, a)
			}
		}
	}
	return absAll(rest, wd), mode
}

func absAll(args []string, wd string) []string {
	var out []string
	for _, a := range args {
		if len(a) == 0 || a[0] == '-' {
			continue
		}
		if !filepath.IsAbs(a) {
			a = filepath.Join(wd, a)
		}
		if _, err := os.Stat(a); err == nil {
			out = append(out, a)
		}
	}
	return out
}
