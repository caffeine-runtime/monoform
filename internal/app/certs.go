package app

import (
	"fmt"
	"os"
	"time"

	"github.com/caffeine-runtime/hold-it-all/internal/certs"
)

// CertInspect reads certificates/keys from a file (password for PKCS#12).
func (a *App) CertInspect(path, password string) (certs.Result, error) {
	st, err := os.Stat(path)
	if err != nil {
		return certs.Result{}, err
	}
	if st.Size() > 16<<20 {
		return certs.Result{}, fmt.Errorf("this file is too large to be a certificate (%d MB)", st.Size()>>20)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return certs.Result{}, err
	}
	return certs.Inspect(b, password, time.Now())
}
