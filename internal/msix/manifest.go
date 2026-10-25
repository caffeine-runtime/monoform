// Package msix writes the AppxManifest.xml of Monoform's Microsoft Store
// package (MSIX): identity, tiles, the file types from wails.json (through
// setup.Assocs, the list the Windows setup program registers) with a Quick
// peek verb, the monoform command as an execution alias, and full trust.
// The Store signs the package; cmd/msix and CI pack it with makeappx.
package msix

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/caffeine-runtime/monoform/internal/setup"
)

// Meta is the package identity from Partner Center (Product identity) and
// the version being packed.
type Meta struct {
	Name                 string // Package/Identity/Name, e.g. "12345Publisher.Monoform"
	Publisher            string // Package/Identity/Publisher, e.g. "CN=…"
	PublisherDisplayName string
	Version              string // the release, x.y.z (a -suffix is dropped)
}

// reserved are extensions a package may not associate (Windows' list).
var reserved = map[string]bool{}

func init() {
	for _, e := range strings.Fields(`accountpicture-ms appx application appref-ms bat cer chm cmd com cpl crt dll drv exe fon gadget
		hlp hta inf ins jse lnk msi msp ocx pif ps1 reg scf scr shb shs sys ttf url vbe vbs ws wsc wsf wsh`) {
		reserved[e] = true
	}
}

var versionRE = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$`)

// PackageVersion turns a release version into the package's four-part one
// (the Store wants the last part 0): "1.3.2" → "1.3.2.0".
func PackageVersion(v string) (string, error) {
	m := versionRE.FindStringSubmatch(v)
	if m == nil {
		return "", fmt.Errorf("version %q isn't x.y.z", v)
	}
	return m[1] + "." + m[2] + "." + m[3] + ".0", nil
}

// Group is one file-type association: the extensions sharing a description.
type Group struct {
	Name, DisplayName, Icon string
	Exts                    []string
	QuickView               bool // opens in the quick-view window (pictures)
}

// Groups are the associations in wails.json order, reserved extensions left out.
func Groups(assocs []setup.Assoc) []Group {
	var out []Group
	at := map[string]int{}
	for _, a := range assocs {
		if reserved[a.Ext] {
			continue
		}
		i, ok := at[a.Description]
		if !ok {
			i = len(out)
			at[a.Description] = i
			out = append(out, Group{Name: slug(a.Description), DisplayName: a.Description, Icon: a.Icon, QuickView: true})
		}
		out[i].Exts = append(out[i].Exts, "."+a.Ext)
		out[i].QuickView = out[i].QuickView && setup.QuickView(a.Ext)
	}
	return out
}

func slug(s string) string {
	return strings.Trim(regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(strings.ToLower(s), "-"), "-")
}

func esc(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

// Manifest is the AppxManifest.xml for m.
func Manifest(m Meta, assocs []setup.Assoc) ([]byte, error) {
	v, err := PackageVersion(m.Version)
	if err != nil {
		return nil, err
	}
	if m.Name == "" || !strings.HasPrefix(m.Publisher, "CN=") || m.PublisherDisplayName == "" {
		return nil, fmt.Errorf("incomplete identity %+v", m)
	}
	var b strings.Builder
	w := func(format string, a ...any) { fmt.Fprintf(&b, format+"\n", a...) }
	w(`<?xml version="1.0" encoding="utf-8"?>`)
	w(`<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"`)
	w(`  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"`)
	w(`  xmlns:uap2="http://schemas.microsoft.com/appx/manifest/uap/windows10/2"`)
	w(`  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"`)
	w(`  xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"`)
	w(`  xmlns:desktop4="http://schemas.microsoft.com/appx/manifest/desktop/windows10/4"`)
	w(`  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"`)
	w(`  IgnorableNamespaces="uap uap2 uap3 uap5 desktop4 rescap">`)
	w(`  <Identity Name="%s" Publisher="%s" Version="%s" ProcessorArchitecture="x64"/>`, esc(m.Name), esc(m.Publisher), v)
	w(`  <Properties>`)
	w(`    <DisplayName>%s</DisplayName>`, setup.Product)
	w(`    <PublisherDisplayName>%s</PublisherDisplayName>`, esc(m.PublisherDisplayName))
	w(`    <Logo>Assets\StoreLogo.png</Logo>`)
	w(`  </Properties>`)
	w(`  <Dependencies>`)
	w(`    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0"/>`)
	w(`  </Dependencies>`)
	w(`  <Resources>`)
	w(`    <Resource Language="en-us"/>`)
	w(`  </Resources>`)
	w(`  <Applications>`)
	w(`    <Application Id="Monoform" Executable="%s" EntryPoint="Windows.FullTrustApplication">`, setup.Exe)
	w(`      <uap:VisualElements DisplayName="%s" Description="One window for everyday files" BackgroundColor="transparent"`, setup.Product)
	w(`        Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png">`)
	w(`        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png"/>`)
	w(`      </uap:VisualElements>`)
	w(`      <Extensions>`)
	for _, g := range Groups(assocs) {
		w(`        <uap3:Extension Category="windows.fileTypeAssociation">`)
		w(`          <uap3:FileTypeAssociation Name="%s">`, g.Name)
		w(`            <uap:DisplayName>%s</uap:DisplayName>`, esc(g.DisplayName))
		w(`            <uap:Logo>Assets\%s.png</uap:Logo>`, g.Icon)
		w(`            <uap:SupportedFileTypes>`)
		for _, e := range g.Exts {
			w(`              <uap:FileType>%s</uap:FileType>`, e)
		}
		w(`            </uap:SupportedFileTypes>`)
		// Like the setup program: pictures open in the quick-view window,
		// everything else in the app with Quick peek beside Open.
		w(`            <uap2:SupportedVerbs>`)
		if g.QuickView {
			w(`              <uap3:Verb Id="open" Parameters="--peek &quot;%%1&quot;">Open</uap3:Verb>`)
		} else {
			w(`              <uap3:Verb Id="open" Parameters="&quot;%%1&quot;">Open</uap3:Verb>`)
			w(`              <uap3:Verb Id="peek" Parameters="--peek &quot;%%1&quot;">Quick peek with %s</uap3:Verb>`, setup.Product)
		}
		w(`            </uap2:SupportedVerbs>`)
		w(`          </uap3:FileTypeAssociation>`)
		w(`        </uap3:Extension>`)
	}
	w(`      </Extensions>`)
	w(`    </Application>`)
	// The monoform command (the console program): its own application, off
	// the Start menu, as an execution alias (console aliases need multiple instances).
	w(`    <Application Id="Command" Executable="%s" EntryPoint="Windows.FullTrustApplication" desktop4:SupportsMultipleInstances="true">`, setup.CLIExe)
	w(`      <uap:VisualElements DisplayName="%s command" Description="The monoform command" BackgroundColor="transparent" AppListEntry="none"`, setup.Product)
	w(`        Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png"/>`)
	w(`      <Extensions>`)
	w(`        <uap5:Extension Category="windows.appExecutionAlias">`)
	w(`          <uap5:AppExecutionAlias desktop4:Subsystem="console">`)
	w(`            <uap5:ExecutionAlias Alias="monoform.exe"/>`)
	w(`          </uap5:AppExecutionAlias>`)
	w(`        </uap5:Extension>`)
	w(`      </Extensions>`)
	w(`    </Application>`)
	w(`  </Applications>`)
	w(`  <Capabilities>`)
	w(`    <rescap:Capability Name="runFullTrust"/>`)
	w(`  </Capabilities>`)
	w(`</Package>`)
	return []byte(b.String()), nil
}

// Assets are the files under Assets\ the manifest names (logos at their
// base names; build/windows/msix/Assets also holds scale and target-size
// variants, picked through resources.pri).
func Assets(assocs []setup.Assoc) []string {
	out := []string{"StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png", "Wide310x150Logo.png"}
	seen := map[string]bool{}
	for _, g := range Groups(assocs) {
		if !seen[g.Icon] {
			seen[g.Icon] = true
			out = append(out, g.Icon+".png")
		}
	}
	return out
}
