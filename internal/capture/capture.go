// Package capture takes screenshots with what the system provides — no cgo,
// nothing bundled: macOS's screencapture, the desktop's screenshot portal
// (xdg-desktop-portal, also on Wayland) or a screenshot tool on Linux, and
// .NET's screen copy via PowerShell on Windows.
package capture

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Mode is what to capture.
type Mode string

const (
	Region Mode = "region" // the user drags out an area (or picks a window, where the tool offers it)
	Screen Mode = "screen" // everything, no questions
)

var (
	// ErrCancelled is returned when the user dismissed the capture.
	ErrCancelled = errors.New("screenshot cancelled")
	// ErrUnavailable is returned when no way of taking screenshots was found.
	ErrUnavailable = errors.New("no screenshot tool found")
)

// Result says how the shot was taken.
type Result struct {
	Path string `json:"path"`
	// Interactive is false when a region was asked for but the whole screen
	// was captured (the caller then offers cropping).
	Interactive bool   `json:"interactive"`
	Method      string `json:"method"`
}

// lookPath and run are replaced in tests.
var (
	lookPath = exec.LookPath
	run      = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, name, args...)
		hideWindow(cmd)
		return cmd.CombinedOutput()
	}
	goos = runtime.GOOS
)

// tool is a command line that writes a PNG to the path given as {}.
type tool struct {
	name        string
	args        []string
	interactive bool
	shell       bool // args[0] is a shell script (for grim + slurp)
}

// linuxTools lists screenshot commands in order of preference.
func linuxTools(mode Mode) []tool {
	if mode == Region {
		return []tool{
			{name: "gnome-screenshot", args: []string{"-a", "-f", "{}"}, interactive: true},
			{name: "spectacle", args: []string{"-b", "-n", "-r", "-o", "{}"}, interactive: true},
			{name: "grim", args: []string{`g=$(slurp) || exit 3; grim -g "$g" "$1"`}, interactive: true, shell: true},
			{name: "xfce4-screenshooter", args: []string{"-r", "-s", "{}"}, interactive: true},
			{name: "maim", args: []string{"-s", "{}"}, interactive: true},
			{name: "scrot", args: []string{"-s", "-o", "{}"}, interactive: true},
			{name: "import", args: []string{"{}"}, interactive: true},
		}
	}
	return []tool{
		{name: "gnome-screenshot", args: []string{"-f", "{}"}},
		{name: "spectacle", args: []string{"-b", "-n", "-f", "-o", "{}"}},
		{name: "grim", args: []string{"{}"}},
		{name: "xfce4-screenshooter", args: []string{"-f", "-s", "{}"}},
		{name: "maim", args: []string{"{}"}},
		{name: "scrot", args: []string{"-o", "{}"}},
		{name: "import", args: []string{"-window", "root", "{}"}},
	}
}

func (t tool) available() bool {
	if _, err := lookPath(t.name); err != nil {
		return false
	}
	if t.shell {
		_, err := lookPath("slurp")
		return err == nil
	}
	return true
}

func (t tool) exec(ctx context.Context, dst string) error {
	var err error
	var out []byte
	if t.shell {
		out, err = run(ctx, "sh", "-c", t.args[0], "sh", dst)
	} else {
		args := make([]string, len(t.args))
		for i, a := range t.args {
			args[i] = strings.ReplaceAll(a, "{}", dst)
		}
		out, err = run(ctx, t.name, args...)
	}
	if st, serr := os.Stat(dst); serr == nil && st.Size() > 0 {
		return nil
	}
	if err != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	// No file: the user pressed Escape (most tools exit non-zero), or it failed.
	if t.interactive {
		return ErrCancelled
	}
	if err != nil {
		return fmt.Errorf("%s: %v %s", t.name, err, strings.TrimSpace(string(out)))
	}
	return fmt.Errorf("%s wrote no image", t.name)
}

// Take captures the screen into dst (a .png path).
func Take(ctx context.Context, mode Mode, dst string) (Result, error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return Result{}, err
	}
	os.Remove(dst)
	switch goos {
	case "darwin":
		args := []string{"-x", dst}
		if mode == Region {
			args = []string{"-x", "-i", dst} // drag an area, or Space to pick a window
		}
		if _, err := run(ctx, "screencapture", args...); err != nil && ctx.Err() != nil {
			return Result{}, ctx.Err()
		}
		if st, err := os.Stat(dst); err != nil || st.Size() == 0 {
			if mode == Region {
				return Result{}, ErrCancelled
			}
			return Result{}, errors.New("screencapture wrote no image (allow screen recording for Monoform in System Settings → Privacy & Security)")
		}
		return Result{Path: dst, Interactive: mode == Region, Method: "screencapture"}, nil
	case "windows":
		if err := windowsScreen(ctx, dst); err != nil {
			return Result{}, err
		}
		return Result{Path: dst, Interactive: false, Method: "powershell"}, nil
	}
	// Linux and other Unix desktops: the portal first (works on Wayland), then tools.
	if os.Getenv("MF_NO_PORTAL") == "" {
		pctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		uri, err := portalScreenshot(pctx, mode == Region)
		cancel()
		switch {
		case err == nil:
			if err := copyFile(strings.TrimPrefix(uri, "file://"), dst); err != nil {
				return Result{}, err
			}
			return Result{Path: dst, Interactive: mode == Region, Method: "portal"}, nil
		case errors.Is(err, ErrCancelled):
			return Result{}, err
		}
		// No portal (or it failed): try the tools.
	}
	var tried []string
	for _, t := range linuxTools(mode) {
		if !t.available() {
			continue
		}
		tried = append(tried, t.name)
		err := t.exec(ctx, dst)
		if err == nil {
			return Result{Path: dst, Interactive: t.interactive, Method: t.name}, nil
		}
		if errors.Is(err, ErrCancelled) || errors.Is(err, context.Canceled) {
			return Result{}, err
		}
	}
	if mode == Region {
		// Nothing interactive works: take the whole screen; the caller offers cropping.
		r, err := Take(ctx, Screen, dst)
		r.Interactive = false
		return r, err
	}
	if len(tried) > 0 {
		return Result{}, fmt.Errorf("the screenshot tools failed (%s)", strings.Join(tried, ", "))
	}
	return Result{}, fmt.Errorf("%w: install gnome-screenshot, spectacle, grim and slurp, maim, scrot or ImageMagick", ErrUnavailable)
}

// windowsScreen copies the whole virtual screen (all monitors) with .NET.
func windowsScreen(ctx context.Context, dst string) error {
	script := `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[void][System.Windows.Forms.Application]::EnableVisualStyles()
try { Add-Type 'using System.Runtime.InteropServices; public class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'; [void][D]::SetProcessDPIAware() } catch {}
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save($env:MF_SHOT, [System.Drawing.Imaging.ImageFormat]::Png)`
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "MF_SHOT="+dst)
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	if st, serr := os.Stat(dst); serr == nil && st.Size() > 0 {
		return nil
	}
	if err != nil {
		return fmt.Errorf("screen capture failed: %v %s", err, strings.TrimSpace(string(out)))
	}
	return errors.New("screen capture wrote no image")
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, b, 0o644)
}
