package ai

import (
	"os"
	"path/filepath"
	"runtime"

	"github.com/caffeine-runtime/hold-it-all/internal/download"
)

// Pack is an optional feature's download: its model files (the runtime is
// shared and comes with the first pack installed).
type Pack struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Purpose string `json:"purpose"`
	Model   string `json:"model"`
	License string `json:"license"`
	Source  string `json:"source"` // repository@revision
	Files   []PackFile
}

// PackFile is one file of a pack, stored as Name in the pack's folder.
type PackFile struct {
	Name string
	download.File
}

const hf = "https://huggingface.co/"

// Subject finds the main subject of a picture: BiRefNet lite (MIT) in a
// static-shape ONNX export whose deformable convolutions are written as
// GridSample, which ONNX Runtime runs in ~6 s and 2 GB on 4 cores (the
// onnx-community export takes 29 s and 7 GB).
var Subject = Pack{
	ID:      "subject",
	Name:    "Better subject selection",
	Purpose: "Select subject and Remove background find people, hair and objects much more precisely.",
	Model:   "BiRefNet lite",
	License: "MIT",
	Source:  "CoderViking/birefnet-lite-onnx@dc06453148f01ef4131f17e9b791345e32e8ee78",
	Files: []PackFile{{"birefnet-lite-1024.onnx", download.File{
		URL:    hf + "CoderViking/birefnet-lite-onnx/resolve/dc06453148f01ef4131f17e9b791345e32e8ee78/birefnet-lite-1024.onnx",
		Size:   199681624,
		SHA256: "50a57872cc739192446da2a934159f957c81af8b5a161dfda8e3daa51660ca67",
	}}},
}

// Eraser removes objects and fills the gap: Moebius (Apache-2.0, ECCV 2026),
// a 0.22B-parameter diffusion inpainting model, exported to ONNX as VAE
// encoder, UNet and VAE decoder at a fixed 512×512.
var Eraser = Pack{
	ID:      "eraser",
	Name:    "Object removal",
	Purpose: "Remove object erases what you selected and fills the gap with what could be behind it.",
	Model:   "Moebius",
	License: "Apache-2.0",
	Source:  "simonw/Moebius-ONNX@5bf1ef5d2861ec01a727183a3f95dc64f352120e",
	Files: []PackFile{
		{"vae_encoder.onnx", download.File{URL: hf + "simonw/Moebius-ONNX/resolve/5bf1ef5d2861ec01a727183a3f95dc64f352120e/vae_encoder.onnx", Size: 136757093, SHA256: "b8b81d41e757222a0707665ba9d826703987855e5bed056036b90b988968042f"}},
		{"unet.onnx", download.File{URL: hf + "simonw/Moebius-ONNX/resolve/5bf1ef5d2861ec01a727183a3f95dc64f352120e/unet.onnx", Size: 906698976, SHA256: "e3f90f52f72378339b990459fadb29a68d3c7b5c6851545ba42774f489160b08"}},
		{"vae_decoder.onnx", download.File{URL: hf + "simonw/Moebius-ONNX/resolve/5bf1ef5d2861ec01a727183a3f95dc64f352120e/vae_decoder.onnx", Size: 198078671, SHA256: "d90ef0b7f6c8c8b7234459c8b449d70be0033bf1576c842e8b9991baf3934280"}},
		{"LICENSE", download.File{URL: hf + "simonw/Moebius-ONNX/resolve/5bf1ef5d2861ec01a727183a3f95dc64f352120e/LICENSE", Size: 11217, SHA256: "4ecabceee3bc23f3c2fa833c678eb58aad40b0845d5bb0759568c33117fa9ab4"}},
	},
}

// Packs are all optional model downloads, in the order Settings lists them.
var Packs = []Pack{Subject, Eraser}

// PackByID finds a pack.
func PackByID(id string) (Pack, bool) {
	for _, p := range Packs {
		if p.ID == id {
			return p, true
		}
	}
	return Pack{}, false
}

// RuntimeVersion is the ONNX Runtime release the packs run on (MIT,
// Microsoft). Only this platform's library is fetched from the official
// NuGet package, with Range requests for just that file.
const RuntimeVersion = "1.31.0"

const nupkg = "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.31.0/microsoft.ml.onnxruntime.1.31.0.nupkg"

type runtimeFile struct {
	name string
	download.File
}

var runtimes = map[string]runtimeFile{
	"windows/amd64": {"onnxruntime.dll", download.File{URL: nupkg, Size: 17253176, SHA256: "0c42dc4e278f0968fdf9ebf1b1e54a74c657a9942e70803e453c91993451cf4c", Zip: &download.ZipMember{HeaderOffset: 152948620, CompressedSize: 6331918, Method: 8}}},
	"windows/arm64": {"onnxruntime.dll", download.File{URL: nupkg, Size: 17507640, SHA256: "b6da671624bce049c13c34a3b48b7ddfd1b521dbf07d20e83ff9af4441110641", Zip: &download.ZipMember{HeaderOffset: 146627738, CompressedSize: 6307983, Method: 8}}},
	"linux/amd64":   {"libonnxruntime.so", download.File{URL: nupkg, Size: 29345384, SHA256: "469849977cb60744ea160927e1a3a0643fd4c55c0aff743251c6d293402e334e", Zip: &download.ZipMember{HeaderOffset: 122902757, CompressedSize: 11156796, Method: 8}}},
	"linux/arm64":   {"libonnxruntime.so", download.File{URL: nupkg, Size: 25266408, SHA256: "595c7f7a6775f5c7b3d567c3ed94c04f722092575abcc092560f5208a54daf99", Zip: &download.ZipMember{HeaderOffset: 112816815, CompressedSize: 10083753, Method: 8}}},
	"darwin/arm64":  {"libonnxruntime.dylib", download.File{URL: nupkg, Size: 44830288, SHA256: "83973572676032b4ba9418afed0b51f45599d35bb4e4628ca8ae1954c8362e31", Zip: &download.ZipMember{HeaderOffset: 134061396, CompressedSize: 12566266, Method: 8}}},
}

// The runtime's licence and notices travel with it.
var runtimeNotices = []runtimeFile{
	{"LICENSE", download.File{URL: nupkg, Size: 1094, SHA256: "c250d6278f0b47a6439fb7592b08b58a55eb9f535aa49a1db63211c3f982b674", Zip: &download.ZipMember{HeaderOffset: 159302284, CompressedSize: 637, Method: 8}}},
	{"ThirdPartyNotices.txt", download.File{URL: nupkg, Size: 344457, SHA256: "c53a76501ef60db6f865f20599f220761201ac4057683acefdab37d861b86622", Zip: &download.ZipMember{HeaderOffset: 159302958, CompressedSize: 33312, Method: 8}}},
}

func platformRuntime() (runtimeFile, bool) {
	r, ok := runtimes[runtime.GOOS+"/"+runtime.GOARCH]
	return r, ok
}

// Supported reports whether this platform has a runtime (not Intel Macs).
func Supported() bool {
	_, ok := platformRuntime()
	return ok
}

// Store is where packs and the runtime live: <dir>/onnxruntime-<version>/,
// <dir>/<pack id>/.
type Store struct{ Dir string }

func (s Store) runtimeDir() string { return filepath.Join(s.Dir, "onnxruntime-"+RuntimeVersion) }

func (s Store) packDir(p Pack) string { return filepath.Join(s.Dir, p.ID) }

// RuntimePath is the native library's path (whether or not it's there yet).
func (s Store) RuntimePath() string {
	r, _ := platformRuntime()
	return filepath.Join(s.runtimeDir(), r.name)
}

// RuntimeInstalled reports whether the library is downloaded.
func (s Store) RuntimeInstalled() bool {
	r, ok := platformRuntime()
	return ok && download.Present(s.RuntimePath(), r.File)
}

// Installed reports whether a pack and the runtime are both downloaded.
func (s Store) Installed(p Pack) bool {
	if !s.RuntimeInstalled() {
		return false
	}
	for _, f := range p.Files {
		if !download.Present(filepath.Join(s.packDir(p), f.Name), f.File) {
			return false
		}
	}
	return true
}

// ModelPath is the path of one of a pack's files.
func (s Store) ModelPath(p Pack, name string) string { return filepath.Join(s.packDir(p), name) }

// DownloadBytes is what installing p transfers now (the runtime only if
// it's missing).
func (s Store) DownloadBytes(p Pack) int64 {
	var n int64
	for _, f := range p.Files {
		if !download.Present(filepath.Join(s.packDir(p), f.Name), f.File) {
			n += f.Transfer()
		}
	}
	if r, ok := platformRuntime(); ok && !s.RuntimeInstalled() {
		n += r.Transfer()
		for _, f := range runtimeNotices {
			n += f.Transfer()
		}
	}
	return n
}

// DiskBytes is the space an installed pack takes (without the runtime).
func (p Pack) DiskBytes() int64 {
	var n int64
	for _, f := range p.Files {
		n += f.Size
	}
	return n
}

// RuntimeDiskBytes is the space the runtime takes on this platform.
func RuntimeDiskBytes() int64 {
	r, _ := platformRuntime()
	n := r.Size
	for _, f := range runtimeNotices {
		n += f.Size
	}
	return n
}

// Remove deletes a pack, and the runtime when no other pack needs it.
func (s Store) Remove(p Pack) error {
	if err := os.RemoveAll(s.packDir(p)); err != nil {
		return err
	}
	for _, o := range Packs {
		if o.ID != p.ID && s.Installed(o) {
			return nil
		}
	}
	return os.RemoveAll(s.runtimeDir())
}
