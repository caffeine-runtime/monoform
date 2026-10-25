package msix

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/caffeine-runtime/monoform/internal/setup"
)

var meta = Meta{Name: "12345Example.Monoform", Publisher: "CN=00000000-0000-0000-0000-000000000000", PublisherDisplayName: "Example & Co", Version: "1.3.2-beta.1"}

func TestPackageVersion(t *testing.T) {
	for in, want := range map[string]string{"1.3.2": "1.3.2.0", "2.0.0-rc.1": "2.0.0.0", "0.0.0-dev+abc1234": "0.0.0.0"} {
		if got, err := PackageVersion(in); err != nil || got != want {
			t.Errorf("%s: %q %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "1.2", "v1.2.3", "1.2.3.4"} {
		if _, err := PackageVersion(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestManifest(t *testing.T) {
	data, err := Manifest(meta, setup.Assocs)
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Identity struct {
			Name, Publisher, Version string `xml:",attr"`
		}
		Properties struct {
			PublisherDisplayName string
		}
		Extensions []struct {
			FileTypeAssociation *struct {
				Name string   `xml:",attr"`
				Exts []string `xml:"SupportedFileTypes>FileType"`
			}
			AppExecutionAlias *struct {
				ExecutionAlias struct {
					Alias string `xml:",attr"`
				}
			}
		} `xml:"Applications>Application>Extensions>Extension"`
	}
	if err := xml.Unmarshal(data, &pkg); err != nil {
		t.Fatalf("not XML: %v\n%s", err, data)
	}
	var exts, names []string
	alias := ""
	for _, e := range pkg.Extensions {
		if f := e.FileTypeAssociation; f != nil {
			names = append(names, f.Name)
			exts = append(exts, f.Exts...)
		}
		if a := e.AppExecutionAlias; a != nil {
			alias = a.ExecutionAlias.Alias
		}
	}
	if pkg.Identity.Name != meta.Name || pkg.Identity.Publisher != meta.Publisher || pkg.Identity.Version != "1.3.2.0" {
		t.Errorf("identity %+v", pkg.Identity)
	}
	if pkg.Properties.PublisherDisplayName != "Example & Co" {
		t.Errorf("publisher name %q (escaping)", pkg.Properties.PublisherDisplayName)
	}
	if alias != "monoform.exe" {
		t.Errorf("alias %q", alias)
	}
	// Every file type of the setup program, once, lower case.
	if len(exts) != len(setup.Assocs) {
		t.Errorf("%d file types, setup has %d", len(exts), len(setup.Assocs))
	}
	seen := map[string]bool{}
	for _, e := range exts {
		if seen[e] || e != strings.ToLower(e) || !strings.HasPrefix(e, ".") || reserved[e[1:]] {
			t.Errorf("file type %q", e)
		}
		seen[e] = true
	}
	// Association names: unique, lower case, short.
	name := regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,99}$`)
	uniq := map[string]bool{}
	for _, n := range names {
		if uniq[n] || !name.MatchString(n) {
			t.Errorf("association name %q", n)
		}
		uniq[n] = true
	}
	// Pictures open in quick view; other types get a Quick peek verb.
	if !strings.Contains(string(data), `<uap:FileType>.png</uap:FileType>`) || strings.Count(string(data), `Id="peek"`) != len(names)-2 {
		t.Errorf("verbs: %d peek verbs for %d associations", strings.Count(string(data), `Id="peek"`), len(names))
	}
}

func TestReservedLeftOut(t *testing.T) {
	g := Groups([]setup.Assoc{{Ext: "ttf", Description: "Font", Icon: "file-text"}, {Ext: "md", Description: "Markdown document", Icon: "file-markdown"}})
	if len(g) != 1 || g[0].Exts[0] != ".md" || g[0].Name != "markdown-document" || g[0].QuickView {
		t.Errorf("%+v", g)
	}
}

func TestIncompleteIdentity(t *testing.T) {
	for _, m := range []Meta{{}, {Name: "a", Publisher: "Example", PublisherDisplayName: "x", Version: "1.0.0"}, {Name: "a", Publisher: "CN=x", Version: "1.0.0"}} {
		if _, err := Manifest(m, setup.Assocs); err == nil {
			t.Errorf("%+v accepted", m)
		}
	}
}

// The logos the manifest names are in build/windows/msix/Assets (scripts/icons.py --msix).
func TestAssetsExist(t *testing.T) {
	for _, a := range Assets(setup.Assocs) {
		if _, err := os.Stat(filepath.Join("..", "..", "build", "windows", "msix", "Assets", a)); err != nil {
			t.Errorf("%s: %v (run scripts/icons.py --msix)", a, err)
		}
	}
}
