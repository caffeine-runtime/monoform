package certs

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/pem"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"

	"software.sslmate.com/src/go-pkcs12"
)

var now = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

type pair struct {
	cert *x509.Certificate
	der  []byte
	key  *ecdsa.PrivateKey
}

func issue(t *testing.T, tmpl *x509.Certificate, parent *pair) pair {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	signer, issuer := key, tmpl
	if parent != nil {
		signer, issuer = parent.key, parent.cert
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, issuer, &key.PublicKey, signer)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := x509.ParseCertificate(der)
	return pair{c, der, key}
}

func chain(t *testing.T) (root, leaf pair) {
	root = issue(t, &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test Root", Organization: []string{"Hold It All"}, Country: []string{"PL"}},
		NotBefore: now.AddDate(-1, 0, 0), NotAfter: now.AddDate(10, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}, nil)
	leaf = issue(t, &x509.Certificate{
		SerialNumber: big.NewInt(0x1234), Subject: pkix.Name{CommonName: "www.example.test"},
		NotBefore: now.AddDate(0, -2, 0), NotAfter: now.AddDate(0, 0, 12), DNSNames: []string{"www.example.test", "example.test"}, IPAddresses: []net.IP{net.ParseIP("10.0.0.1")},
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, OCSPServer: []string{"http://ocsp.example.test"},
	}, &root)
	return
}

func pemOf(typ string, b []byte) []byte { return pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: b}) }

func TestPEMChain(t *testing.T) {
	root, leaf := chain(t)
	data := append(pemOf("CERTIFICATE", leaf.der), pemOf("CERTIFICATE", root.der)...)
	r, err := Inspect(data, "", now)
	if err != nil {
		t.Fatal(err)
	}
	if r.Format != "PEM" || len(r.Items) != 2 {
		t.Fatalf("%s %d items", r.Format, len(r.Items))
	}
	l, c := r.Items[0], r.Items[1]
	if l.Subject.CommonName != "www.example.test" || l.Issuer.CommonName != "Test Root" || l.Serial != "12:34" {
		t.Errorf("leaf names: %+v", l)
	}
	if l.Status != "expiring" || l.DaysLeft != 12 {
		t.Errorf("leaf status %s %d", l.Status, l.DaysLeft)
	}
	if strings.Join(l.Names, ",") != "www.example.test,example.test,10.0.0.1" || l.ExtKeyUsage[0] != "TLS server" || l.OCSP[0] != "http://ocsp.example.test" {
		t.Errorf("leaf extensions: %v %v %v", l.Names, l.ExtKeyUsage, l.OCSP)
	}
	if l.Key != "ECDSA P-256" || len(l.SHA256) != 95 || len(l.SHA1) != 59 || !l.IssuedByNext {
		t.Errorf("leaf key/fingerprints/chain: %s %d %v", l.Key, len(l.SHA256), l.IssuedByNext)
	}
	if !c.SelfSigned || !c.IsCA || c.Status != "valid" || c.Subject.Country != "PL" {
		t.Errorf("root: %+v", c)
	}
	if !strings.Contains(c.KeyUsage[0], "Certificate signing") && !strings.Contains(strings.Join(c.KeyUsage, ","), "Certificate signing") {
		t.Errorf("root usages %v", c.KeyUsage)
	}
	// Expired, judged at a later time.
	r2, _ := Inspect(pemOf("CERTIFICATE", leaf.der), "", now.AddDate(0, 1, 0))
	if r2.Items[0].Status != "expired" {
		t.Errorf("expired status %s", r2.Items[0].Status)
	}
}

func TestDERCSRAndKeys(t *testing.T) {
	_, leaf := chain(t)
	r, err := Inspect(leaf.der, "", now)
	if err != nil || r.Format != "DER" || r.Items[0].Subject.CommonName != "www.example.test" {
		t.Fatalf("DER: %v %+v", err, r)
	}
	rk, _ := rsa.GenerateKey(rand.Reader, 2048)
	csr, _ := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: "req.test"}, DNSNames: []string{"req.test"}}, rk)
	p8, _ := x509.MarshalPKCS8PrivateKey(leaf.key)
	ec, _ := x509.MarshalECPrivateKey(leaf.key)
	pub, _ := x509.MarshalPKIXPublicKey(&rk.PublicKey)
	data := append(pemOf("CERTIFICATE REQUEST", csr), pemOf("RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(rk))...)
	data = append(data, pemOf("PRIVATE KEY", p8)...)
	data = append(data, pemOf("EC PRIVATE KEY", ec)...)
	data = append(data, pemOf("PUBLIC KEY", pub)...)
	r, err = Inspect(data, "", now)
	if err != nil {
		t.Fatal(err)
	}
	kinds := []string{}
	for _, it := range r.Items {
		kinds = append(kinds, it.Kind+":"+it.Key)
	}
	want := "request:RSA 2048,private-key:RSA 2048,private-key:ECDSA P-256,private-key:ECDSA P-256,public-key:RSA 2048"
	if strings.Join(kinds, ",") != want {
		t.Errorf("got %s", strings.Join(kinds, ","))
	}
	if r.Items[0].Note != "Signature verified." || r.Items[0].Names[0] != "req.test" {
		t.Errorf("csr: %+v", r.Items[0])
	}
	if r.Items[1].PEM != "" || r.Items[1].SPKIPin != r.Items[4].SPKIPin {
		t.Error("private keys must not be echoed; the pin should match the public key")
	}
	if _, err := Inspect([]byte("hello"), "", now); err == nil {
		t.Error("garbage accepted")
	}
}

func TestPKCS12AndPKCS7(t *testing.T) {
	root, leaf := chain(t)
	p12, err := pkcs12.Modern.Encode(leaf.key, leaf.cert, []*x509.Certificate{root.cert}, "s3cret")
	if err != nil {
		t.Fatal(err)
	}
	r, err := Inspect(p12, "", now)
	if err != nil || !r.NeedsPassword {
		t.Fatalf("expected a password prompt: %v %+v", err, r)
	}
	r, err = Inspect(p12, "s3cret", now)
	if err != nil || r.Format != "PKCS#12" || len(r.Items) != 3 {
		t.Fatalf("p12: %v %+v", err, r)
	}
	if r.Items[0].Subject.CommonName != "www.example.test" || !r.Items[0].IssuedByNext || r.Items[2].Kind != "private-key" || !strings.Contains(r.Items[2].Note, "matches") {
		t.Errorf("p12 items: %+v", r.Items)
	}
	// A degenerate PKCS#7 bundle (.p7b) with both certificates.
	certs := append(append([]byte{}, leaf.der...), root.der...)
	sd, _ := asn1.Marshal(struct {
		Version      int
		Digests      asn1.RawValue
		ContentInfo  struct{ Type asn1.ObjectIdentifier }
		Certificates asn1.RawValue `asn1:"tag:0"`
		SignerInfos  asn1.RawValue
	}{1, asn1.RawValue{Tag: 17, IsCompound: true, Class: 0}, struct{ Type asn1.ObjectIdentifier }{asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 1}}, asn1.RawValue{Class: 2, Tag: 0, IsCompound: true, Bytes: certs}, asn1.RawValue{Tag: 17, IsCompound: true}})
	p7, _ := asn1.Marshal(struct {
		Type    asn1.ObjectIdentifier
		Content asn1.RawValue
	}{asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 2}, asn1.RawValue{Class: 2, Tag: 0, IsCompound: true, Bytes: sd}})
	r, err = Inspect(p7, "", now)
	if err != nil || r.Format != "PKCS#7" || len(r.Items) != 2 || !r.Items[0].IssuedByNext {
		t.Fatalf("p7b: %v %+v", err, r)
	}
}
