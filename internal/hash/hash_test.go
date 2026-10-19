package hash

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Standard test vectors: FIPS 180 / RFC 1321 / BLAKE3 reference.
var vectors = map[string]map[string]string{
	"": {
		"md5":    "d41d8cd98f00b204e9800998ecf8427e",
		"sha1":   "da39a3ee5e6b4b0d3255bfef95601890afd80709",
		"sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		"sha512": "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
		"blake3": "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
	},
	"abc": {
		"md5":    "900150983cd24fb0d6963f7d28e17f72",
		"sha1":   "a9993e364706816aba3e25717850c26c9cd0d89d",
		"sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		"sha512": "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
		"blake3": "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85",
	},
	"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq": {
		"sha1":   "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
		"sha256": "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
	},
}

func TestVectors(t *testing.T) {
	for input, want := range vectors {
		var algos []string
		for a := range want {
			algos = append(algos, a)
		}
		got, err := Reader(context.Background(), strings.NewReader(input), int64(len(input)), algos, nil)
		if err != nil {
			t.Fatal(err)
		}
		for a, w := range want {
			if got[a] != w {
				t.Errorf("%s(%q) = %s, want %s", a, input, got[a], w)
			}
		}
	}
}

func TestMillionA(t *testing.T) {
	// FIPS 180-2: one million 'a'.
	in := strings.Repeat("a", 1_000_000)
	got, _ := Reader(context.Background(), strings.NewReader(in), int64(len(in)), []string{"sha1", "sha256", "md5"}, nil)
	if got["sha1"] != "34aa973cd4c4daa4f61eeb2bdbad27316534016f" || got["sha256"] != "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0" || got["md5"] != "7707d6ae4e027c70eea2a935c2296f21" {
		t.Fatalf("got %v", got)
	}
}

func TestBufferBoundaries(t *testing.T) {
	// Inputs around the 1 MiB buffer size hash the same as in one piece.
	for _, n := range []int{bufSize - 1, bufSize, bufSize + 1, 3*bufSize + 7} {
		data := bytes.Repeat([]byte{0x5a, 0x01, 0xff}, n/3+1)[:n]
		a, _ := Reader(context.Background(), bytes.NewReader(data), int64(n), Algorithms, nil)
		b, _ := Reader(context.Background(), io.MultiReader(bytes.NewReader(data[:n/2]), bytes.NewReader(data[n/2:])), int64(n), Algorithms, nil)
		for _, alg := range Algorithms {
			if a[alg] != b[alg] {
				t.Fatalf("n=%d %s differs", n, alg)
			}
		}
	}
}

type slowReader struct{ n int64 }

func (s *slowReader) Read(p []byte) (int, error) {
	if s.n <= 0 {
		return 0, io.EOF
	}
	time.Sleep(2 * time.Millisecond)
	k := int64(len(p))
	if k > s.n {
		k = s.n
	}
	s.n -= k
	return int(k), nil
}

func TestProgressAndCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var calls int
	var last int64
	_, err := Reader(ctx, &slowReader{n: 1 << 40}, 1<<40, []string{"sha256"}, func(done, total int64) {
		calls++
		last = done
		if done >= 8*bufSize {
			cancel()
		}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if calls < 8 || last < 8*bufSize {
		t.Fatalf("progress calls %d last %d", calls, last)
	}
}

func TestChecksumFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("abc"), 0o644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte(""), 0o644)
	os.Mkdir(filepath.Join(dir, "sub"), 0o755)
	os.WriteFile(filepath.Join(dir, "sub", "c d.txt"), []byte("abc"), 0o644)
	gnu := "# made by sha256sum\n" +
		vectors["abc"]["sha256"] + "  a.txt\r\n" +
		vectors[""]["sha256"] + " *b.txt\n" +
		strings.Repeat("0", 64) + "  sub/c d.txt\n" +
		vectors["abc"]["sha256"] + "  missing.txt\n"
	p := filepath.Join(dir, "SHA256SUMS")
	os.WriteFile(p, []byte(gnu), 0o644)
	var streamed []string
	res, err := Verify(context.Background(), p, func(r Result) { streamed = append(streamed, r.Status) }, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(streamed, ",")
	if got != "ok,ok,mismatch,missing" || len(res) != 4 {
		t.Fatalf("statuses = %s", got)
	}
	if res[2].Actual != vectors["abc"]["sha256"] {
		t.Fatal("actual not reported for mismatch")
	}
	// BSD format with mixed algorithms.
	bsd := "MD5 (a.txt) = " + vectors["abc"]["md5"] + "\nSHA512 (b.txt) = " + vectors[""]["sha512"] + "\nBLAKE3 (a.txt) = " + vectors["abc"]["blake3"] + "\n"
	q := filepath.Join(dir, "sums.txt")
	os.WriteFile(q, []byte(bsd), 0o644)
	res, err = Verify(context.Background(), q, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range res {
		if r.Status != "ok" {
			t.Fatalf("bsd %+v", r)
		}
	}
	// .b3 files mean BLAKE3 for 64-hex digests.
	b3 := filepath.Join(dir, "files.b3")
	os.WriteFile(b3, []byte(vectors["abc"]["blake3"]+"  a.txt\n"), 0o644)
	lines, _ := ParseChecksumFile(b3)
	if lines[0].Algo != "blake3" {
		t.Fatalf("algo = %s", lines[0].Algo)
	}
	// md5sum file.
	m := filepath.Join(dir, "x.md5")
	os.WriteFile(m, []byte(vectors["abc"]["md5"]+"  a.txt\n"), 0o644)
	res, _ = Verify(context.Background(), m, nil, nil)
	if res[0].Status != "ok" || res[0].Algo != "md5" {
		t.Fatalf("md5 %+v", res[0])
	}
	empty := filepath.Join(dir, "empty.sha256")
	os.WriteFile(empty, []byte("nothing here\n"), 0o644)
	if _, err := ParseChecksumFile(empty); err == nil {
		t.Fatal("expected error for file without checksums")
	}
}

func TestGuess(t *testing.T) {
	if g := GuessAlgorithm(vectors[""]["sha512"]); g[0] != "sha512" {
		t.Fatal(g)
	}
	if g := GuessAlgorithm("abc"); g != nil {
		t.Fatal(g)
	}
}
