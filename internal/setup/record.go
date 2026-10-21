package setup

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Record is a System that keeps the registry, shortcuts and the command
// shim in memory and writes files under Root (paths are taken relative to
// it). Tests and the demo mode on other systems use it.
type Record struct {
	Root string

	mu        sync.Mutex
	reg       map[string]map[string]string // "HKCU\key" → value name → value
	Shortcuts map[string]string            // "HKCU Programs\Hold It All" → target
	Shims     map[string]string
	Notified  int
}

func NewRecord(root string) *Record {
	return &Record{Root: root, reg: map[string]map[string]string{}, Shortcuts: map[string]string{}, Shims: map[string]string{}}
}

func (r *Record) path(p string) string {
	// Windows paths (C:\...) under the root, as relative paths.
	p = strings.ReplaceAll(p, `\`, "/")
	if len(p) > 1 && p[1] == ':' {
		p = p[2:]
	}
	if strings.HasPrefix(p, r.Root) {
		return p
	}
	return filepath.Join(r.Root, filepath.FromSlash(p))
}

func (r *Record) WriteFile(p string, src io.Reader) error {
	dst := r.path(p)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, src); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func (r *Record) RemoveAll(p string) error { return os.RemoveAll(r.path(p)) }

func k(root Root, key string) string { return root.String() + `\` + strings.ToLower(key) }

func (r *Record) SetString(root Root, key, name, value string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.reg[k(root, key)]
	if m == nil {
		m = map[string]string{}
		r.reg[k(root, key)] = m
	}
	m[name] = value
	return nil
}

func (r *Record) SetDWord(root Root, key, name string, value uint32) error {
	return r.SetString(root, key, name, itoa(value))
}

func itoa(v uint32) string {
	if v == 0 {
		return "0"
	}
	var b []byte
	for ; v > 0; v /= 10 {
		b = append([]byte{byte('0' + v%10)}, b...)
	}
	return string(b)
}

func (r *Record) GetString(root Root, key, name string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.reg[k(root, key)][name]
	return v, ok
}

func (r *Record) DeleteValue(root Root, key, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.reg[k(root, key)], name)
	return nil
}

func (r *Record) DeleteKey(root Root, key string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	p := k(root, key)
	for kk := range r.reg {
		if kk == p || strings.HasPrefix(kk, p+`\`) {
			delete(r.reg, kk)
		}
	}
	return nil
}

func (r *Record) Shortcut(root Root, folder Folder, name, target, args string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Shortcuts[root.String()+" "+string(folder)+`\`+name] = strings.TrimSpace(target + " " + args)
	return nil
}

func (r *Record) RemoveShortcut(root Root, folder Folder, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.Shortcuts, root.String()+" "+string(folder)+`\`+name)
	return nil
}

func (r *Record) CommandShim(name, body string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if body == "" {
		delete(r.Shims, name)
	} else {
		r.Shims[name] = body
	}
	return nil
}

func (r *Record) AssocChanged() {
	r.mu.Lock()
	r.Notified++
	r.mu.Unlock()
}

// Keys lists the registry keys that have values, sorted (for tests and the demo log).
func (r *Record) Keys() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for kk, m := range r.reg {
		if len(m) > 0 {
			out = append(out, kk)
		}
	}
	sort.Strings(out)
	return out
}

type recordFile struct {
	Reg       map[string]map[string]string `json:"registry"`
	Shortcuts map[string]string            `json:"shortcuts"`
	Shims     map[string]string            `json:"shims"`
}

// Save writes the recorded registry, shortcuts and shims (the demo keeps them between runs).
func (r *Record) Save(path string) error {
	r.mu.Lock()
	data, err := json.MarshalIndent(recordFile{r.reg, r.Shortcuts, r.Shims}, "", "  ")
	r.mu.Unlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// Load reads what Save wrote (a missing file is no error).
func (r *Record) Load(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var f recordFile
	if err := json.Unmarshal(data, &f); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if f.Reg != nil {
		r.reg = f.Reg
	}
	if f.Shortcuts != nil {
		r.Shortcuts = f.Shortcuts
	}
	if f.Shims != nil {
		r.Shims = f.Shims
	}
	return nil
}
