package locale

import (
	"reflect"
	"testing"
)

func TestNormalize(t *testing.T) {
	for in, want := range map[string]string{
		"pl_PL.UTF-8": "pl-PL", "es_ES@euro": "es-ES", "en-us": "en-US", "es-419": "es-419",
		"C": "", "POSIX": "", "": "", "zh-Hant-TW": "zh-Hant-TW", "PL": "pl",
	} {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLanguagesOverrideAndEnv(t *testing.T) {
	t.Setenv("MF_SYSTEM_LANG", "pl_PL.UTF-8,en_US")
	if got := Languages(); !reflect.DeepEqual(got, []string{"pl-PL", "en-US"}) {
		t.Errorf("override: %v", got)
	}
	t.Setenv("MF_SYSTEM_LANG", "")
	t.Setenv("LANGUAGE", "es_ES:en")
	t.Setenv("LC_ALL", "")
	t.Setenv("LC_MESSAGES", "")
	t.Setenv("LANG", "es_ES.UTF-8")
	if got := fromEnv(); !reflect.DeepEqual(normalizeAll(got), []string{"es-ES", "en"}) {
		t.Errorf("env: %v", got)
	}
}
