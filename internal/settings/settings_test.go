package settings

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenMissingGivesDefaults(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "nope", "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	got := s.Get()
	if got.Theme != "system" || !got.SidebarVisible || got.Recents == nil {
		t.Fatalf("defaults = %+v", got)
	}
}

func TestRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "cfg", "settings.json")
	s, _ := Open(p)
	v := s.Get()
	v.Theme = "light"
	v.Pinned = []string{"/a/b.md"}
	v.Session = Session{Folder: "/x", Tabs: []SessionTab{{Kind: "file", Path: "/x/a.md", State: `{"view":"split"}`}}, Active: 0}
	if err := s.Set(v); err != nil {
		t.Fatal(err)
	}
	s2, _ := Open(p)
	got := s2.Get()
	if got.Theme != "light" || got.Pinned[0] != "/a/b.md" || got.Session.Tabs[0].State != `{"view":"split"}` {
		t.Fatalf("reloaded = %+v", got)
	}
}

func TestCorruptFileIsSetAside(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "settings.json")
	os.WriteFile(p, []byte("{not json"), 0o644)
	s, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if s.Get().Theme != "system" {
		t.Fatal("expected defaults")
	}
	if _, err := os.Stat(p + ".bad"); err != nil {
		t.Fatal("corrupt file not kept as .bad")
	}
}

func TestNormalize(t *testing.T) {
	v := Settings{Theme: "neon", SidebarWidth: 5, Session: Session{Active: 7}}
	n := normalize(v)
	if n.Theme != "system" || n.SidebarWidth != 260 || n.Session.Active != 0 || n.Pinned == nil {
		t.Fatalf("normalize = %+v", n)
	}
}

func TestNormalizeScaleAndSplit(t *testing.T) {
	tabs := []SessionTab{{Kind: "file"}, {Kind: "file"}, {Kind: "file"}}
	n := normalize(Settings{UIScale: 9, Session: Session{Tabs: tabs, Split: &SessionSplit{Layout: "columns", Panes: []int{0, 2}, X: 0.99}}})
	if n.UIScale != 1 || n.Session.Split == nil || n.Session.Split.X != 0.85 || n.Session.Split.Y != 0.5 {
		t.Fatalf("normalize = %+v %+v", n.UIScale, n.Session.Split)
	}
	for _, bad := range []*SessionSplit{
		{Layout: "spiral", Panes: []int{0, 1}},
		{Layout: "grid", Panes: []int{0}},
		{Layout: "grid", Panes: []int{0, 5}},
		{Layout: "rows", Panes: []int{1, 1}},
	} {
		if n := normalize(Settings{Session: Session{Tabs: tabs, Split: bad}}); n.Session.Split != nil {
			t.Errorf("kept invalid split %+v", bad)
		}
	}
	if n := normalize(Settings{UIScale: 1.25}); n.UIScale != 1.25 {
		t.Errorf("scale %v", n.UIScale)
	}
}

func TestAddRecent(t *testing.T) {
	l := []string{"a", "b", "c"}
	l = AddRecent(l, "b")
	if strings.Join(l, ",") != "b,a,c" {
		t.Fatalf("got %v", l)
	}
	for i := 0; i < 50; i++ {
		l = AddRecent(l, string(rune('A'+i)))
	}
	if len(l) != MaxRecents {
		t.Fatalf("len = %d", len(l))
	}
}

func TestUpdate(t *testing.T) {
	s, _ := Open(filepath.Join(t.TempDir(), "s.json"))
	got, err := s.Update(func(v *Settings) { v.Recents = AddRecent(v.Recents, "/f") })
	if err != nil || got.Recents[0] != "/f" {
		t.Fatalf("update = %+v %v", got, err)
	}
	// The returned value must not alias internal state.
	got.Recents[0] = "mutated"
	if s.Get().Recents[0] != "/f" {
		t.Fatal("aliasing")
	}
}

func TestRecentsOffClearsLists(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	v := s.Get()
	v.Recents = []string{"/a.txt"}
	v.RecentFolders = []string{"/notes"}
	v.RecentsOff = true
	if err := s.Set(v); err != nil {
		t.Fatal(err)
	}
	got := s.Get()
	if len(got.Recents) != 0 || len(got.RecentFolders) != 0 || !got.RecentsOff {
		t.Fatalf("recents kept while off: %+v", got)
	}
}

func TestMoveOld(t *testing.T) {
	base := t.TempDir()
	if moveOld(base) {
		t.Fatal("nothing to move")
	}
	os.MkdirAll(filepath.Join(base, "HoldItAll", "history"), 0o755)
	os.WriteFile(filepath.Join(base, "HoldItAll", "settings.json"), []byte(`{"theme":"dark"}`), 0o644)
	if !moveOld(base) {
		t.Fatal("not moved")
	}
	if b, err := os.ReadFile(filepath.Join(base, "Monoform", "settings.json")); err != nil || string(b) != `{"theme":"dark"}` {
		t.Errorf("settings: %q %v", b, err)
	}
	if _, err := os.Stat(filepath.Join(base, "HoldItAll")); !os.IsNotExist(err) {
		t.Error("old folder left")
	}
	// Once there's a Monoform folder, an old one is left alone.
	os.MkdirAll(filepath.Join(base, "HoldItAll"), 0o755)
	if moveOld(base) {
		t.Error("moved over existing data")
	}
}
