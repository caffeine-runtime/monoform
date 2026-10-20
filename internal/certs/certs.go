// Package certs inspects certificates and keys: PEM (any number of blocks),
// DER, PKCS#12 (.p12/.pfx, password-protected) and PKCS#7 bundles (.p7b) —
// who a certificate is for and from, when it expires, its names, key,
// usages and fingerprints, whether a chain in the file links up, plus CSRs,
// private and public keys (never showing private key material).
package certs

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/md5"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"software.sslmate.com/src/go-pkcs12"
)

// Name is a distinguished name, split into the common parts.
type Name struct {
	Full         string `json:"full"`
	CommonName   string `json:"commonName"`
	Organization string `json:"organization"`
	Unit         string `json:"unit"`
	Country      string `json:"country"`
	Locality     string `json:"locality"`
	State        string `json:"state"`
	Email        string `json:"email"`
}

// Item is one thing found in the file.
type Item struct {
	Kind         string    `json:"kind"` // certificate | request | private-key | public-key | crl
	Subject      Name      `json:"subject"`
	Issuer       Name      `json:"issuer"`
	Serial       string    `json:"serial"`
	NotBefore    time.Time `json:"notBefore"`
	NotAfter     time.Time `json:"notAfter"`
	DaysLeft     int       `json:"daysLeft"`
	Status       string    `json:"status"` // valid | expiring | expired | not-yet-valid
	SelfSigned   bool      `json:"selfSigned"`
	IsCA         bool      `json:"isCA"`
	PathLen      int       `json:"pathLen"` // -1 = none
	Names        []string  `json:"names"`   // subject alternative names
	Key          string    `json:"key"`     // "RSA 2048", "ECDSA P-256", "Ed25519"
	Signature    string    `json:"signature"`
	KeyUsage     []string  `json:"keyUsage"`
	ExtKeyUsage  []string  `json:"extKeyUsage"`
	SHA256       string    `json:"sha256"`
	SHA1         string    `json:"sha1"`
	MD5          string    `json:"md5"`
	SPKIPin      string    `json:"spkiPin"` // base64 SHA-256 of the public key (HPKP / pinning)
	OCSP         []string  `json:"ocsp"`
	CAIssuers    []string  `json:"caIssuers"`
	CRLs         []string  `json:"crls"`
	PEM          string    `json:"pem"`        // certificates, requests and public keys only
	IssuedByNext bool      `json:"issuedByNext"` // signed by the next certificate in the file
	Encrypted    bool      `json:"encrypted"`
	Note         string    `json:"note"`
}

// Result of inspecting a file.
type Result struct {
	Format        string `json:"format"` // PEM | DER | PKCS#12 | PKCS#7
	Items         []Item `json:"items"`
	NeedsPassword bool   `json:"needsPassword"`
}

// ErrNeedsPassword means a PKCS#12 file needs a (different) password.
var ErrNeedsPassword = errors.New("this file is protected by a password")

// Inspect reads certificates and keys from data. now is the reference time
// for expiry (time.Now() in the app).
func Inspect(data []byte, password string, now time.Time) (Result, error) {
	trimmed := bytes.TrimSpace(data)
	if bytes.Contains(trimmed, []byte("-----BEGIN ")) {
		return inspectPEM(trimmed, now)
	}
	// PKCS#12 before plain DER (it's DER too).
	if r, err := inspectP12(data, password, now); err == nil {
		return r, nil
	} else if errors.Is(err, ErrNeedsPassword) {
		return Result{Format: "PKCS#12", NeedsPassword: true}, nil
	}
	if certs, err := parsePKCS7(data); err == nil && len(certs) > 0 {
		r := Result{Format: "PKCS#7"}
		for _, c := range certs {
			r.Items = append(r.Items, certItem(c, now))
		}
		linkChain(r.Items, certs)
		return r, nil
	}
	it, err := der(data, now)
	if err != nil {
		return Result{}, err
	}
	return Result{Format: "DER", Items: []Item{it}}, nil
}

func inspectPEM(data []byte, now time.Time) (Result, error) {
	r := Result{Format: "PEM"}
	var chain []*x509.Certificate
	rest := data
	for {
		var b *pem.Block
		b, rest = pem.Decode(rest)
		if b == nil {
			break
		}
		switch b.Type {
		case "CERTIFICATE", "TRUSTED CERTIFICATE", "X509 CERTIFICATE":
			c, err := x509.ParseCertificate(b.Bytes)
			if err != nil {
				r.Items = append(r.Items, Item{Kind: "certificate", Note: "Couldn't read this certificate: " + err.Error()})
				continue
			}
			chain = append(chain, c)
			r.Items = append(r.Items, certItem(c, now))
		case "CERTIFICATE REQUEST", "NEW CERTIFICATE REQUEST":
			q, err := x509.ParseCertificateRequest(b.Bytes)
			if err != nil {
				r.Items = append(r.Items, Item{Kind: "request", Note: err.Error()})
				continue
			}
			r.Items = append(r.Items, csrItem(q))
		case "PUBLIC KEY", "RSA PUBLIC KEY":
			var k any
			var err error
			if b.Type == "RSA PUBLIC KEY" {
				k, err = x509.ParsePKCS1PublicKey(b.Bytes)
			} else {
				k, err = x509.ParsePKIXPublicKey(b.Bytes)
			}
			it := Item{Kind: "public-key", PEM: string(pem.EncodeToMemory(b))}
			if err != nil {
				it.Note = err.Error()
			} else {
				it.Key = keyDesc(k)
				if der, err := x509.MarshalPKIXPublicKey(k); err == nil {
					it.SPKIPin = pin(der)
					it.SHA256 = colonHex(sha256.Sum256(der))
				}
			}
			r.Items = append(r.Items, it)
		case "ENCRYPTED PRIVATE KEY":
			r.Items = append(r.Items, Item{Kind: "private-key", Encrypted: true, Key: "encrypted (PKCS#8)", Note: "The key is encrypted; its type is only known after decrypting."})
		case "PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "OPENSSH PRIVATE KEY":
			r.Items = append(r.Items, keyItem(b))
		case "X509 CRL":
			l, err := x509.ParseRevocationList(b.Bytes)
			it := Item{Kind: "crl"}
			if err != nil {
				it.Note = err.Error()
			} else {
				it.Issuer = name(l.Issuer)
				it.NotBefore = l.ThisUpdate
				it.NotAfter = l.NextUpdate
				it.Note = fmt.Sprintf("%d revoked certificate(s)", len(l.RevokedCertificateEntries))
				it.Status, it.DaysLeft = status(l.ThisUpdate, l.NextUpdate, now)
			}
			r.Items = append(r.Items, it)
		case "PKCS7":
			certs, err := parsePKCS7(b.Bytes)
			if err != nil {
				r.Items = append(r.Items, Item{Kind: "certificate", Note: "PKCS#7: " + err.Error()})
			}
			for _, c := range certs {
				chain = append(chain, c)
				r.Items = append(r.Items, certItem(c, now))
			}
		default:
			r.Items = append(r.Items, Item{Kind: strings.ToLower(b.Type), Note: "Not inspected (" + b.Type + ")"})
		}
	}
	if len(r.Items) == 0 {
		return r, errors.New("no PEM blocks found")
	}
	// Link consecutive certificates (leaf → intermediate → root).
	var certItems []int
	for i, it := range r.Items {
		if it.Kind == "certificate" && it.SHA256 != "" {
			certItems = append(certItems, i)
		}
	}
	for k := 0; k+1 < len(chain) && k+1 < len(certItems); k++ {
		r.Items[certItems[k]].IssuedByNext = chain[k].CheckSignatureFrom(chain[k+1]) == nil
	}
	return r, nil
}

func linkChain(items []Item, chain []*x509.Certificate) {
	for k := 0; k+1 < len(chain); k++ {
		items[k].IssuedByNext = chain[k].CheckSignatureFrom(chain[k+1]) == nil
	}
}

func der(data []byte, now time.Time) (Item, error) {
	if c, err := x509.ParseCertificate(data); err == nil {
		return certItem(c, now), nil
	}
	if q, err := x509.ParseCertificateRequest(data); err == nil {
		return csrItem(q), nil
	}
	if k, err := x509.ParsePKIXPublicKey(data); err == nil {
		return Item{Kind: "public-key", Key: keyDesc(k), SPKIPin: pin(data), SHA256: colonHex(sha256.Sum256(data))}, nil
	}
	for _, p := range []func([]byte) (any, error){x509.ParsePKCS8PrivateKey, func(b []byte) (any, error) { return x509.ParsePKCS1PrivateKey(b) }, func(b []byte) (any, error) { return x509.ParseECPrivateKey(b) }} {
		if k, err := p(data); err == nil {
			return Item{Kind: "private-key", Key: keyDesc(publicOf(k)), Note: "Private key (not shown)."}, nil
		}
	}
	return Item{}, errors.New("not a certificate, request or key this app can read (PEM, DER, PKCS#12, PKCS#7)")
}

func inspectP12(data []byte, password string, now time.Time) (Result, error) {
	if len(data) < 4 || data[0] != 0x30 {
		return Result{}, errors.New("not PKCS#12")
	}
	key, leaf, cas, err := pkcs12.DecodeChain(data, password)
	if err != nil {
		if errors.Is(err, pkcs12.ErrIncorrectPassword) {
			return Result{}, ErrNeedsPassword
		}
		// Trust stores (certificates only).
		if certs, terr := pkcs12.DecodeTrustStore(data, password); terr == nil {
			r := Result{Format: "PKCS#12"}
			for _, c := range certs {
				r.Items = append(r.Items, certItem(c, now))
			}
			return r, nil
		} else if errors.Is(terr, pkcs12.ErrIncorrectPassword) {
			return Result{}, ErrNeedsPassword
		}
		return Result{}, err
	}
	r := Result{Format: "PKCS#12"}
	chain := append([]*x509.Certificate{leaf}, cas...)
	for _, c := range chain {
		r.Items = append(r.Items, certItem(c, now))
	}
	linkChain(r.Items, chain)
	if key != nil {
		it := Item{Kind: "private-key", Key: keyDesc(publicOf(key)), Note: "Private key (not shown)."}
		if pk, ok := publicOf(key).(interface{ Equal(crypto.PublicKey) bool }); ok && leaf != nil && pk.Equal(leaf.PublicKey) {
			it.Note += " It matches the certificate."
		}
		r.Items = append(r.Items, it)
	}
	return r, nil
}

// parsePKCS7 extracts certificates from a degenerate PKCS#7 SignedData (.p7b/.p7c).
func parsePKCS7(data []byte) ([]*x509.Certificate, error) {
	var ci struct {
		Type    asn1.ObjectIdentifier
		Content asn1.RawValue // [0] EXPLICIT SignedData
	}
	if _, err := asn1.Unmarshal(data, &ci); err != nil {
		return nil, err
	}
	if !ci.Type.Equal(asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 2}) {
		return nil, errors.New("not PKCS#7 signed data")
	}
	var sd struct {
		Version      int
		Digests      asn1.RawValue
		ContentInfo  asn1.RawValue
		Certificates asn1.RawValue `asn1:"optional,tag:0"`
	}
	if ci.Content.Class != asn1.ClassContextSpecific || ci.Content.Tag != 0 {
		return nil, errors.New("not PKCS#7 signed data")
	}
	if _, err := asn1.Unmarshal(ci.Content.Bytes, &sd); err != nil {
		return nil, err
	}
	return x509.ParseCertificates(sd.Certificates.Bytes)
}

func certItem(c *x509.Certificate, now time.Time) Item {
	it := Item{
		Kind:        "certificate",
		Subject:     name(c.Subject),
		Issuer:      name(c.Issuer),
		Serial:      serial(c.SerialNumber),
		NotBefore:   c.NotBefore,
		NotAfter:    c.NotAfter,
		SelfSigned:  bytes.Equal(c.RawIssuer, c.RawSubject) && c.CheckSignatureFrom(c) == nil,
		IsCA:        c.IsCA,
		PathLen:     -1,
		Key:         keyDesc(c.PublicKey),
		Signature:   c.SignatureAlgorithm.String(),
		KeyUsage:    keyUsage(c.KeyUsage),
		SHA256:      colonHex(sha256.Sum256(c.Raw)),
		SHA1:        colonHex(sha1.Sum(c.Raw)),
		MD5:         colonHex(md5.Sum(c.Raw)),
		SPKIPin:     pin(c.RawSubjectPublicKeyInfo),
		OCSP:        c.OCSPServer,
		CAIssuers:   c.IssuingCertificateURL,
		CRLs:        c.CRLDistributionPoints,
		PEM:         string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Raw})),
		Names:       []string{},
		ExtKeyUsage: []string{},
	}
	if c.BasicConstraintsValid && c.IsCA && (c.MaxPathLen > 0 || c.MaxPathLenZero) {
		it.PathLen = c.MaxPathLen
	}
	it.Status, it.DaysLeft = status(c.NotBefore, c.NotAfter, now)
	it.Names = append(it.Names, c.DNSNames...)
	for _, ip := range c.IPAddresses {
		it.Names = append(it.Names, ip.String())
	}
	it.Names = append(it.Names, c.EmailAddresses...)
	for _, u := range c.URIs {
		it.Names = append(it.Names, u.String())
	}
	for _, u := range c.ExtKeyUsage {
		it.ExtKeyUsage = append(it.ExtKeyUsage, extUsage(u))
	}
	return it
}

func csrItem(q *x509.CertificateRequest) Item {
	it := Item{Kind: "request", Subject: name(q.Subject), Key: keyDesc(q.PublicKey), Signature: q.SignatureAlgorithm.String(), SPKIPin: pin(q.RawSubjectPublicKeyInfo), SHA256: colonHex(sha256.Sum256(q.Raw)), PEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: q.Raw})), Names: []string{}}
	it.Names = append(it.Names, q.DNSNames...)
	for _, ip := range q.IPAddresses {
		it.Names = append(it.Names, ip.String())
	}
	it.Names = append(it.Names, q.EmailAddresses...)
	if err := q.CheckSignature(); err != nil {
		it.Note = "The request's signature doesn't verify: " + err.Error()
	} else {
		it.Note = "Signature verified."
	}
	return it
}

func keyItem(b *pem.Block) Item {
	it := Item{Kind: "private-key", Note: "Private key (not shown)."}
	if _, enc := b.Headers["Proc-Type"]; enc {
		it.Encrypted = true
		it.Key = "encrypted"
		it.Note = "The key is encrypted with a passphrase (legacy PEM encryption)."
		return it
	}
	var k any
	var err error
	switch b.Type {
	case "RSA PRIVATE KEY":
		k, err = x509.ParsePKCS1PrivateKey(b.Bytes)
	case "EC PRIVATE KEY":
		k, err = x509.ParseECPrivateKey(b.Bytes)
	case "OPENSSH PRIVATE KEY":
		it.Key = "OpenSSH"
		return it
	default:
		k, err = x509.ParsePKCS8PrivateKey(b.Bytes)
	}
	if err != nil {
		it.Note = "Couldn't read this key: " + err.Error()
		return it
	}
	pub := publicOf(k)
	it.Key = keyDesc(pub)
	if der, err := x509.MarshalPKIXPublicKey(pub); err == nil {
		it.SPKIPin = pin(der)
	}
	return it
}

func publicOf(k any) any {
	if s, ok := k.(interface{ Public() any }); ok {
		return s.Public()
	}
	switch v := k.(type) {
	case *rsa.PrivateKey:
		return &v.PublicKey
	case *ecdsa.PrivateKey:
		return &v.PublicKey
	case ed25519.PrivateKey:
		return v.Public()
	}
	return k
}

func keyDesc(k any) string {
	switch v := k.(type) {
	case *rsa.PublicKey:
		return fmt.Sprintf("RSA %d", v.N.BitLen())
	case *ecdsa.PublicKey:
		return "ECDSA " + v.Curve.Params().Name
	case ed25519.PublicKey:
		return "Ed25519"
	case nil:
		return ""
	}
	return fmt.Sprintf("%T", k)
}

func name(n pkix.Name) Name {
	first := func(s []string) string {
		if len(s) > 0 {
			return s[0]
		}
		return ""
	}
	out := Name{Full: n.String(), CommonName: n.CommonName, Organization: first(n.Organization), Unit: first(n.OrganizationalUnit), Country: first(n.Country), Locality: first(n.Locality), State: first(n.Province)}
	for _, a := range n.Names {
		if a.Type.Equal(asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 1}) {
			out.Email, _ = a.Value.(string)
		}
	}
	return out
}

func status(from, to, now time.Time) (string, int) {
	days := int(to.Sub(now).Hours() / 24)
	switch {
	case now.Before(from):
		return "not-yet-valid", days
	case now.After(to):
		return "expired", days
	case days < 30:
		return "expiring", days
	}
	return "valid", days
}

func serial(n *big.Int) string {
	if n == nil {
		return ""
	}
	b := n.Bytes()
	if len(b) == 0 {
		b = []byte{0}
	}
	return colonHexBytes(b)
}

func colonHex[T ~[16]byte | ~[20]byte | ~[32]byte](a T) string {
	b := make([]byte, len(a))
	for i := range b {
		b[i] = a[i]
	}
	return colonHexBytes(b)
}

func colonHexBytes(b []byte) string {
	h := strings.ToUpper(hex.EncodeToString(b))
	var sb strings.Builder
	for i := 0; i < len(h); i += 2 {
		if i > 0 {
			sb.WriteByte(':')
		}
		sb.WriteString(h[i : i+2])
	}
	return sb.String()
}

func pin(spki []byte) string {
	s := sha256.Sum256(spki)
	return base64.StdEncoding.EncodeToString(s[:])
}

func keyUsage(u x509.KeyUsage) []string {
	names := []string{"Digital signature", "Content commitment", "Key encipherment", "Data encipherment", "Key agreement", "Certificate signing", "CRL signing", "Encipher only", "Decipher only"}
	out := []string{}
	for i, n := range names {
		if u&(1<<i) != 0 {
			out = append(out, n)
		}
	}
	return out
}

func extUsage(u x509.ExtKeyUsage) string {
	switch u {
	case x509.ExtKeyUsageServerAuth:
		return "TLS server"
	case x509.ExtKeyUsageClientAuth:
		return "TLS client"
	case x509.ExtKeyUsageCodeSigning:
		return "Code signing"
	case x509.ExtKeyUsageEmailProtection:
		return "Email (S/MIME)"
	case x509.ExtKeyUsageTimeStamping:
		return "Time stamping"
	case x509.ExtKeyUsageOCSPSigning:
		return "OCSP signing"
	case x509.ExtKeyUsageAny:
		return "Any"
	}
	return fmt.Sprintf("Other (%d)", u)
}
