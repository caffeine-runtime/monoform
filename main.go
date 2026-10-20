package main

import (
	"embed"
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

	"github.com/caffeine-runtime/hold-it-all/internal/app"
	"github.com/caffeine-runtime/hold-it-all/internal/cli"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

var processStart = time.Now()

func main() {
	// holdit hash / verify / info / convert … run without a window.
	if cli.IsCommand(os.Args[1:]) {
		cli.AttachConsole()
		code, _ := cli.Main(os.Args[1:], app.Version, os.Stdout, os.Stderr)
		os.Exit(code)
	}
	wd, _ := os.Getwd()
	files, mode := parseLaunch(os.Args[1:], wd)
	a := app.New(processStart, files, mode)
	width, height := 1280, 820
	if mode == "peek" {
		// Quick peek: a small window; "Open in editor" makes it full size.
		width, height = 960, 680
	}
	if dist, err := fs.Sub(assets, "frontend/dist"); err == nil {
		a.Assets = dist
	}

	err := wails.Run(&options.App{
		Title:            "Hold It All",
		Width:            width,
		Height:           height,
		MinWidth:         640,
		MinHeight:        400,
		BackgroundColour: &options.RGBA{R: 31, G: 30, B: 28, A: 255},
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: a.Server.Middleware,
		},
		OnStartup:     a.Startup,
		OnShutdown:    a.Shutdown,
		OnBeforeClose: a.BeforeClose,
		Bind:          []interface{}{a},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "dev.holditall.app",
			OnSecondInstanceLaunch: func(d options.SecondInstanceData) {
				files, mode := parseLaunch(d.Args, d.WorkingDirectory)
				a.OpenFilesMode(files, mode)
			},
		},
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			About:    &mac.AboutInfo{Title: "Hold It All", Message: "One window for your everyday files.", Icon: icon},
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
			ProgramName:      "hold-it-all",
			WebviewGpuPolicy: linux.WebviewGpuPolicyOnDemand,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

// parseLaunch splits the command line into files to open (existing paths,
// made absolute) and the mode: "peek" (--peek), "preview" (--preview) or "".
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
