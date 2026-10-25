package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/caffeine-runtime/monoform/internal/update"
)

// The Microsoft Store build never asks GitHub and can't download or install.
func TestUpdateStoreBuild(t *testing.T) {
	asked := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = true
		http.Error(w, "no", http.StatusTeapot)
	}))
	defer srv.Close()
	t.Setenv("MF_UPDATE_API", srv.URL)
	t.Setenv("MF_STORE_FAKE", "1")
	defer func(v, api string) { Version, update.API = v, api }(Version, update.API)
	Version = "1.0.0"

	a := &App{}
	info, err := a.UpdateCheck()
	if err != nil {
		t.Fatal(err)
	}
	if info.Install != "store" || info.Available || asked {
		t.Errorf("store build: %+v, asked GitHub: %v", info, asked)
	}
	if _, err := a.UpdateDownload(); err == nil {
		t.Error("store build downloaded an update")
	}
	if err := a.UpdateInstall("x"); err == nil {
		t.Error("store build installed an update")
	}
}
