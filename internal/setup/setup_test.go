package setup

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func payload(names ...string) []File {
	var out []File
	for _, n := range names {
		data := []byte("contents of " + n)
		out = append(out, File{Name: n, Size: int64(len(data)), Open: func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil }})
	}
	return out
}

var testAssocs = []Assoc{{Ext: "md", ProgID: "HoldItAll.md", Description: "Markdown document", Icon: "file-markdown"}, {Ext: "png", ProgID: "HoldItAll.png", Description: "PNG image", Icon: "file-image"}}

func TestInstallAndUninstall(t *testing.T) {
	root := t.TempDir()
	sys := NewRecord(root)
	// Another app had .png before.
	sys.SetString(User, `Classes\.png`, "", "Photos.png")
	dir := `C:\Users\ana\AppData\Local\Programs\Hold It All`
	files := payload(append([]string{Exe, "holdit.exe"}, Icons(testAssocs)...)...)
	self := payload("hold-it-all-setup.exe")[0]
	var steps []string
	o := Options{Dir: dir, Desktop: true, Defaults: true, Command: true, Version: "2.0.0"}
	if err := Install(sys, files, self, o, testAssocs, func(s string, done, total int64) { steps = append(steps, s) }); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{Exe, "holdit.exe", "file-markdown.ico", "file-image.ico", UninstallExe} {
		if _, err := os.Stat(filepath.Join(root, "Users/ana/AppData/Local/Programs/Hold It All", f)); err != nil {
			t.Errorf("%s not written: %v", f, err)
		}
	}
	if steps[len(steps)-1] != "Done" || !strings.HasPrefix(steps[0], "Copying") {
		t.Errorf("steps %v", steps)
	}
	if sys.Shortcuts[`HKCU Programs\Hold It All`] == "" || sys.Shortcuts[`HKCU Desktop\Hold It All`] == "" {
		t.Errorf("shortcuts %v", sys.Shortcuts)
	}
	if !strings.Contains(sys.Shims["holdit.cmd"], `Hold It All\holdit.exe" %*`) {
		t.Errorf("shim %q", sys.Shims["holdit.cmd"])
	}
	get := func(key, name string) string { v, _ := sys.GetString(User, key, name); return v }
	if get(`Classes\.png`, "") != "HoldItAll.png" || get(`Classes\.png`, "HoldItAll.png_backup") != "Photos.png" {
		t.Errorf("png default %q backup %q", get(`Classes\.png`, ""), get(`Classes\.png`, "HoldItAll.png_backup"))
	}
	if get(`Classes\HoldItAll.md\shell\open\command`, "") != `"`+join(dir, Exe)+`" "%1"` {
		t.Errorf("open command %q", get(`Classes\HoldItAll.md\shell\open\command`, ""))
	}
	// Each type has its own icon; pictures open in a quick view, Edit opens the editor.
	if get(`Classes\HoldItAll.md\DefaultIcon`, "") != join(dir, "file-markdown.ico") || get(`Classes\HoldItAll.png\DefaultIcon`, "") != join(dir, "file-image.ico") {
		t.Errorf("icons %q %q", get(`Classes\HoldItAll.md\DefaultIcon`, ""), get(`Classes\HoldItAll.png\DefaultIcon`, ""))
	}
	if get(`Classes\HoldItAll.png\shell\open\command`, "") != `"`+join(dir, Exe)+`" --peek "%1"` || get(`Classes\HoldItAll.png\shell\edit\command`, "") != `"`+join(dir, Exe)+`" "%1"` {
		t.Errorf("png open %q edit %q", get(`Classes\HoldItAll.png\shell\open\command`, ""), get(`Classes\HoldItAll.png\shell\edit\command`, ""))
	}
	if get(`Classes\HoldItAll.md\shell\edit\command`, "") != "" {
		t.Error("edit verb on a type that opens in the editor anyway")
	}
	if get(`Classes\*\shell\HoldItAll.Peek\command`, "") == "" || get(`Classes\Applications\hold-it-all.exe\SupportedTypes`, ".md") != "" {
		t.Error("peek verb / open with")
	}
	if get(uninstKey, "DisplayVersion") != "2.0.0" || !strings.HasSuffix(get(uninstKey, "UninstallString"), `uninstall.exe" --uninstall`) || get(uninstKey, "EstimatedSize") == "" {
		t.Errorf("uninstall entry %q %q", get(uninstKey, "DisplayVersion"), get(uninstKey, "UninstallString"))
	}
	if sys.Notified != 1 {
		t.Errorf("explorer told %d times", sys.Notified)
	}

	in, ok := Find(sys)
	if !ok || in.Dir != dir || in.Version != "2.0.0" || in.Everyone || !in.Defaults || !in.Command || !in.Desktop {
		t.Fatalf("find: %+v %v", in, ok)
	}
	if err := Uninstall(sys, in, testAssocs, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "Users/ana/AppData/Local/Programs/Hold It All")); !os.IsNotExist(err) {
		t.Errorf("folder left: %v", err)
	}
	if get(`Classes\.png`, "") != "Photos.png" {
		t.Errorf(".png not given back: %q", get(`Classes\.png`, ""))
	}
	if _, ok := sys.GetString(User, `Classes\.md`, ""); ok {
		t.Error(".md default left")
	}
	// Only the other app's .png remains.
	if keys := sys.Keys(); len(keys) != 1 || keys[0] != `HKCU\classes\.png` {
		t.Errorf("registry left: %v", keys)
	}
	if len(sys.Shortcuts) != 0 || len(sys.Shims) != 0 {
		t.Errorf("left: %v %v", sys.Shortcuts, sys.Shims)
	}
	if _, ok := Find(sys); ok {
		t.Error("still found")
	}
}

func TestEveryoneAndNoDefaults(t *testing.T) {
	sys := NewRecord(t.TempDir())
	o := Options{Dir: `C:\Program Files\Hold It All`, Everyone: true, Version: "2.0.0"}
	if err := Install(sys, payload(Exe), payload("setup.exe")[0], o, testAssocs, nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := sys.GetString(User, uninstKey, "DisplayName"); ok {
		t.Error("written for the user")
	}
	if v, _ := sys.GetString(Machine, uninstKey, "DisplayName"); v != Product {
		t.Error("not written for everyone")
	}
	// Not the default app, but the file classes exist (for "Open with").
	if _, ok := sys.GetString(Machine, `Classes\.md`, ""); ok {
		t.Error("made the default without being asked")
	}
	if v, _ := sys.GetString(Machine, `Classes\.md\OpenWithProgids`, "HoldItAll.md"); v != "" {
		t.Error("open-with progid")
	}
	if len(sys.Shims) != 0 || sys.Notified != 0 {
		t.Error("shim or notify without being asked")
	}
	in, ok := Find(sys)
	if !ok || !in.Everyone {
		t.Fatalf("%+v", in)
	}
}

func TestFindOld(t *testing.T) {
	sys := NewRecord(t.TempDir())
	if _, ok := FindOld(sys); ok {
		t.Fatal("found nothing")
	}
	sys.SetString(Machine, OldUninstKey, "UninstallString", `"C:\Program Files\Hold It All\Hold It All\uninstall.exe"`)
	old, ok := FindOld(sys)
	if !ok || !old.Everyone || old.Uninstall != `"C:\Program Files\Hold It All\Hold It All\uninstall.exe" /S` {
		t.Errorf("%+v", old)
	}
}

func TestAssocsMatchWailsJSON(t *testing.T) {
	data, err := os.ReadFile("../../wails.json")
	if err != nil {
		t.Fatal(err)
	}
	var w struct {
		Info struct {
			FileAssociations []struct{ Ext, Name string } `json:"fileAssociations"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &w); err != nil {
		t.Fatal(err)
	}
	if len(w.Info.FileAssociations) != len(Assocs) {
		t.Fatalf("wails.json has %d file types, setup %d: run go generate ./internal/setup", len(w.Info.FileAssociations), len(Assocs))
	}
	for i, a := range w.Info.FileAssociations {
		if Assocs[i].Ext != a.Ext || Assocs[i].ProgID != a.Name {
			t.Errorf("%d: %v vs %v (run go generate ./internal/setup)", i, Assocs[i], a)
		}
	}
}

func TestIcons(t *testing.T) {
	got := Icons(Assocs)
	if len(got) < 10 || got[0] != "file-text.ico" {
		t.Errorf("%v", got)
	}
	for _, a := range Assocs {
		if a.Icon == "" {
			t.Errorf("%s has no icon", a.Ext)
		} else if _, err := os.Stat(filepath.Join("..", "..", "build", "windows", a.Icon+".ico")); err != nil {
			t.Errorf("%s: %v (run scripts/icons.py)", a.Ext, err)
		}
	}
}
