package app

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/caffeine-runtime/hold-it-all/internal/settings"
)

func TestChildEnv(t *testing.T) {
	env := childEnv([]string{"PATH=/bin", "HIA_TEST=m39", "HIA_TEST_ARG=/fx", "HIA_SETTINGS=/s.json"})
	if !slices.Contains(env, "HIA_TEST=windowchild") || slices.Contains(env, "HIA_TEST=m39") {
		t.Errorf("self-test: %v", env)
	}
	if !slices.Contains(env, "HIA_SETTINGS=/s.json") || !slices.Contains(env, "HIA_TEST_ARG=/fx") {
		t.Errorf("settings and test argument are shared: %v", env)
	}
	if env := childEnv([]string{"PATH=/bin"}); len(env) != 1 {
		t.Errorf("no self-test: %v", env)
	}
}

func TestKeepSession(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	st, _ := settings.Open(path)
	main := st.Get()
	main.Session.Folder = "/main/folder"
	if err := st.Set(main); err != nil {
		t.Fatal(err)
	}
	// The other window changes the theme; its own session is empty.
	other := settings.Defaults()
	other.Theme = "dark"
	got := keepSession(other, path)
	if got.Session.Folder != "/main/folder" || got.Theme != "dark" {
		t.Errorf("session %q theme %q", got.Session.Folder, got.Theme)
	}
}

func TestFitOnScreen(t *testing.T) {
	for _, c := range []struct{ x, y, wantX, wantY int }{
		{100, 50, 100, 50},    // fits
		{1262, 442, 340, 180}, // off the right and bottom of 1440×900
		{-30, -5, 0, 0},       // off the top left
	} {
		if x, y := fitOnScreen(c.x, c.y, 1100, 720, 1440, 900); x != c.wantX || y != c.wantY {
			t.Errorf("fitOnScreen(%d, %d) = %d, %d; want %d, %d", c.x, c.y, x, y, c.wantX, c.wantY)
		}
	}
}
