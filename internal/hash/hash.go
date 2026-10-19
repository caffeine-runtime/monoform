// Package hash computes file checksums (MD5, SHA-1, SHA-256, SHA-512,
// BLAKE3) in one streamed pass with progress and cancellation, and verifies
// checksum files (GNU "hash  name" and BSD "ALGO (name) = hash" formats).
package hash

import (
	"context"
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"fmt"
	gohash "hash"
	"io"
	"os"
	"sync"

	"lukechampine.com/blake3"
)

// Algorithms in display order.
var Algorithms = []string{"md5", "sha1", "sha256", "sha512", "blake3"}

func newHasher(algo string) (gohash.Hash, error) {
	switch algo {
	case "md5":
		return md5.New(), nil
	case "sha1":
		return sha1.New(), nil
	case "sha256":
		return sha256.New(), nil
	case "sha512":
		return sha512.New(), nil
	case "blake3":
		return blake3.New(32, nil), nil
	}
	return nil, fmt.Errorf("unknown algorithm %q", algo)
}

// Progress receives bytes hashed so far and the total.
type Progress func(done, total int64)

const bufSize = 1 << 20

// Reader hashes everything read from r with the given algorithms. Each
// algorithm runs on its own goroutine fed with shared buffers, so throughput
// is limited by the slowest algorithm, not their sum.
func Reader(ctx context.Context, r io.Reader, total int64, algos []string, progress Progress) (map[string]string, error) {
	if len(algos) == 0 {
		algos = []string{"sha256"}
	}
	hashers := make([]gohash.Hash, len(algos))
	for i, a := range algos {
		h, err := newHasher(a)
		if err != nil {
			return nil, err
		}
		hashers[i] = h
	}
	type chunk struct {
		b    []byte
		n    int
		left sync.WaitGroup
	}
	const inflight = 4
	pool := make(chan []byte, inflight)
	for i := 0; i < inflight; i++ {
		pool <- make([]byte, bufSize)
	}
	feeds := make([]chan *chunk, len(hashers))
	var workers sync.WaitGroup
	for i, h := range hashers {
		feeds[i] = make(chan *chunk, inflight)
		workers.Add(1)
		go func(h gohash.Hash, in chan *chunk) {
			defer workers.Done()
			for c := range in {
				h.Write(c.b[:c.n])
				c.left.Done()
			}
		}(h, feeds[i])
	}
	var done int64
	var readErr error
	for {
		if err := ctx.Err(); err != nil {
			readErr = err
			break
		}
		buf := <-pool
		n, err := io.ReadFull(r, buf)
		if n > 0 {
			c := &chunk{b: buf, n: n}
			c.left.Add(len(feeds))
			for _, f := range feeds {
				f <- c
			}
			go func() {
				c.left.Wait()
				pool <- c.b
			}()
			done += int64(n)
			if progress != nil {
				progress(done, total)
			}
		} else {
			pool <- buf
		}
		if err == io.EOF || err == io.ErrUnexpectedEOF {
			break
		}
		if err != nil {
			readErr = err
			break
		}
	}
	for _, f := range feeds {
		close(f)
	}
	workers.Wait()
	if readErr != nil {
		return nil, readErr
	}
	out := make(map[string]string, len(algos))
	for i, a := range algos {
		out[a] = hex.EncodeToString(hashers[i].Sum(nil))
	}
	return out, nil
}

// File hashes the file at path.
func File(ctx context.Context, path string, algos []string, progress Progress) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, errors.New("is a folder")
	}
	return Reader(ctx, f, st.Size(), algos, progress)
}

// GuessAlgorithm infers the algorithm from a hex digest length.
func GuessAlgorithm(digest string) []string {
	switch len(digest) {
	case 32:
		return []string{"md5"}
	case 40:
		return []string{"sha1"}
	case 64:
		return []string{"sha256", "blake3"}
	case 128:
		return []string{"sha512"}
	}
	return nil
}
