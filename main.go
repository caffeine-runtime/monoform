package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"github.com/caffeine-runtime/hold-it-all/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

var processStart = time.Now()

func main() {
	a := app.New(processStart, launchFiles(os.Args[1:]))

	err := wails.Run(&options.App{
		Title:            "Hold It All",
		Width:            1280,
		Height:           820,
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
				a.OpenFiles(absAll(d.Args, d.WorkingDirectory))
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

// launchFiles keeps the command-line arguments that are existing paths.
func launchFiles(args []string) []string {
	wd, _ := os.Getwd()
	return absAll(args, wd)
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
