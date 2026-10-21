// Package download fetches pinned files over HTTPS: the optional models are
// the only network access the app makes, and only after the user asked. Every
// file has a known size and SHA-256; partial downloads never replace a file.
package download

import (
	"compress/flate"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// File is one file to download: where it comes from and what it must be.
type File struct {
	URL    string
	Size   int64  // bytes on disk
	SHA256 string // of the bytes on disk
	// Zip, when set, means URL is a zip archive and the file is one of its
	// members, read with HTTP Range requests (only that member is downloaded).
	Zip *ZipMember
}

// ZipMember locates a member of a zip archive (from its central directory).
type ZipMember struct {
	HeaderOffset   int64 // of the member's local file header
	CompressedSize int64
	Method         uint16 // 0 stored, 8 deflate
}

// Transfer is how many bytes go over the network for f.
func (f File) Transfer() int64 {
	if f.Zip != nil {
		return f.Zip.CompressedSize
	}
	return f.Size
}

// Present reports whether dst exists with f's size (contents were verified
// when it was downloaded).
func Present(dst string, f File) bool {
	st, err := os.Stat(dst)
	return err == nil && st.Size() == f.Size
}

// Fetch downloads f to dst, verifying size and SHA-256 before an atomic
// rename. progress receives the bytes transferred so far (for a zip member,
// estimated from the bytes unpacked).
func Fetch(ctx context.Context, client *http.Client, dst string, f File, progress func(n int64)) error {
	if client == nil {
		client = &http.Client{}
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".part-*")
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	var body io.ReadCloser
	if f.Zip != nil {
		body, err = openMember(ctx, client, f)
	} else {
		body, err = get(ctx, client, f.URL, "")
	}
	if err != nil {
		return err
	}
	defer body.Close()
	h := sha256.New()
	counter := &counting{r: body, progress: progress, scale: float64(f.Transfer()) / float64(max(1, f.Size))}
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(counter, f.Size+1))
	if err != nil {
		return err
	}
	name := filepath.Base(dst)
	if n != f.Size {
		return fmt.Errorf("download %s: got %d bytes, expected %d", name, n, f.Size)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != f.SHA256 {
		return fmt.Errorf("download %s: checksum mismatch", name)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), dst); err != nil {
		return err
	}
	ok = true
	if progress != nil {
		progress(f.Transfer())
	}
	return nil
}

func get(ctx context.Context, client *http.Client, url, rng string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	want := http.StatusOK
	if rng != "" {
		req.Header.Set("Range", rng)
		want = http.StatusPartialContent
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != want {
		resp.Body.Close()
		return nil, fmt.Errorf("download %s: %s", filepath.Base(url), resp.Status)
	}
	return resp.Body, nil
}

// openMember reads the member's local header (its name and extra field
// lengths can differ from the central directory's), then streams and
// decompresses just its data.
func openMember(ctx context.Context, client *http.Client, f File) (io.ReadCloser, error) {
	z := f.Zip
	hb, err := get(ctx, client, f.URL, fmt.Sprintf("bytes=%d-%d", z.HeaderOffset, z.HeaderOffset+29))
	if err != nil {
		return nil, err
	}
	head := make([]byte, 30)
	_, err = io.ReadFull(hb, head)
	hb.Close()
	if err != nil {
		return nil, err
	}
	if binary.LittleEndian.Uint32(head) != 0x04034b50 {
		return nil, errors.New("download: not a zip member header")
	}
	start := z.HeaderOffset + 30 + int64(binary.LittleEndian.Uint16(head[26:])) + int64(binary.LittleEndian.Uint16(head[28:]))
	body, err := get(ctx, client, f.URL, fmt.Sprintf("bytes=%d-%d", start, start+z.CompressedSize-1))
	if err != nil {
		return nil, err
	}
	switch z.Method {
	case 0:
		return body, nil
	case 8:
		fr := flate.NewReader(body)
		return struct {
			io.Reader
			io.Closer
		}{fr, closeBoth{fr, body}}, nil
	}
	body.Close()
	return nil, fmt.Errorf("download: zip method %d not supported", z.Method)
}

type closeBoth [2]io.Closer

func (c closeBoth) Close() error {
	c[0].Close()
	return c[1].Close()
}

// counting reports progress at most every 100 ms, in transferred bytes.
type counting struct {
	r        io.Reader
	n        int64
	scale    float64
	last     time.Time
	progress func(int64)
}

func (c *counting) Read(p []byte) (int, error) {
	k, err := c.r.Read(p)
	c.n += int64(k)
	if c.progress != nil && time.Since(c.last) > 100*time.Millisecond {
		c.progress(int64(float64(c.n) * c.scale))
		c.last = time.Now()
	}
	return k, err
}
