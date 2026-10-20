package capture

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// fake installs pretend tools: have lists the commands that exist; write
// says which ones produce an image.
func fake(t *testing.T, have []string, write map[string]bool) *[]string {
	t.Helper()
	t.Setenv("HIA_NO_PORTAL", "1")
	calls := &[]string{}
	oldLook, oldRun, oldOS := lookPath, run, goos
	t.Cleanup(func() { lookPath, run, goos = oldLook, oldRun, oldOS })
	goos = "linux"
	lookPath = func(name string) (string, error) {
		for _, h := range have {
			if h == name {
				return "/usr/bin/" + name, nil
			}
		}
		return "", exec.ErrNotFound
	}
	run = func(_ context.Context, name string, args ...string) ([]byte, error) {
		*calls = append(*calls, name+" "+strings.Join(args, " "))
		if write[name] {
			dst := args[len(args)-1]
			if name == "sh" {
				dst = args[len(args)-1]
			}
			return nil, os.WriteFile(dst, []byte("\x89PNG fake"), 0o644)
		}
		return []byte("cancelled"), errors.New("exit status 1")
	}
	return calls
}

func TestRegionPrefersInteractiveTools(t *testing.T) {
	calls := fake(t, []string{"scrot", "maim", "import"}, map[string]bool{"maim": true})
	dst := filepath.Join(t.TempDir(), "shots", "a.png")
	r, err := Take(context.Background(), Region, dst)
	if err != nil || r.Method != "maim" || !r.Interactive {
		t.Fatalf("%+v %v", r, err)
	}
	if (*calls)[0] != "maim -s "+dst {
		t.Errorf("calls %v", *calls)
	}
}

func TestCancelStopsAtTheFirstTool(t *testing.T) {
	calls := fake(t, []string{"gnome-screenshot", "scrot"}, map[string]bool{})
	_, err := Take(context.Background(), Region, filepath.Join(t.TempDir(), "a.png"))
	if !errors.Is(err, ErrCancelled) || len(*calls) != 1 {
		t.Fatalf("err %v calls %v", err, *calls)
	}
}

func TestGrimNeedsSlurp(t *testing.T) {
	calls := fake(t, []string{"grim", "scrot"}, map[string]bool{"scrot": true})
	r, err := Take(context.Background(), Region, filepath.Join(t.TempDir(), "a.png"))
	if err != nil || r.Method != "scrot" {
		t.Fatalf("%+v %v %v", r, err, *calls)
	}
	calls = fake(t, []string{"grim", "slurp"}, map[string]bool{"sh": true})
	r, err = Take(context.Background(), Region, filepath.Join(t.TempDir(), "b.png"))
	if err != nil || r.Method != "grim" || !strings.HasPrefix((*calls)[0], "sh -c g=$(slurp)") {
		t.Fatalf("%+v %v %v", r, err, *calls)
	}
}

func TestScreenAndNothingInstalled(t *testing.T) {
	fake(t, []string{"import"}, map[string]bool{"import": true})
	dst := filepath.Join(t.TempDir(), "a.png")
	r, err := Take(context.Background(), Screen, dst)
	if err != nil || r.Interactive {
		t.Fatalf("%+v %v", r, err)
	}
	fake(t, nil, nil)
	if _, err := Take(context.Background(), Screen, dst); !errors.Is(err, ErrUnavailable) {
		t.Errorf("err %v", err)
	}
}

func TestMacUsesScreencapture(t *testing.T) {
	calls := fake(t, nil, map[string]bool{"screencapture": true})
	goos = "darwin"
	dst := filepath.Join(t.TempDir(), "a.png")
	r, err := Take(context.Background(), Region, dst)
	if err != nil || (*calls)[0] != "screencapture -x -i "+dst || !r.Interactive {
		t.Fatalf("%+v %v %v", r, err, *calls)
	}
}

// On a real X display (the CI self-test VM), a full-screen shot works.
func TestRealScreen(t *testing.T) {
	if os.Getenv("DISPLAY") == "" {
		t.Skip("no display")
	}
	t.Setenv("HIA_NO_PORTAL", "1")
	dst := filepath.Join(t.TempDir(), "real.png")
	r, err := Take(context.Background(), Screen, dst)
	if errors.Is(err, ErrUnavailable) {
		t.Skip("no screenshot tool installed")
	}
	if err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(r.Path); st.Size() < 100 {
		t.Errorf("tiny image from %s", r.Method)
	}
}
