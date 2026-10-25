// msix writes the Microsoft Store package's AppxManifest.xml (see
// internal/msix); CI packs it with makeappx:
//
//	go run ./cmd/msix -version 1.3.2 -name ID -publisher CN=… -publisher-name NAME -o stage/AppxManifest.xml
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/caffeine-runtime/monoform/internal/msix"
	"github.com/caffeine-runtime/monoform/internal/setup"
)

func main() {
	var m msix.Meta
	flag.StringVar(&m.Version, "version", "", "release version (x.y.z)")
	flag.StringVar(&m.Name, "name", "", "Package/Identity/Name from Partner Center")
	flag.StringVar(&m.Publisher, "publisher", "", "Package/Identity/Publisher from Partner Center (CN=…)")
	flag.StringVar(&m.PublisherDisplayName, "publisher-name", "", "publisher display name from Partner Center")
	out := flag.String("o", "AppxManifest.xml", "where to write the manifest")
	flag.Parse()
	data, err := msix.Manifest(m, setup.Assocs)
	if err == nil {
		err = os.WriteFile(*out, data, 0o644)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "msix:", err)
		os.Exit(1)
	}
}
