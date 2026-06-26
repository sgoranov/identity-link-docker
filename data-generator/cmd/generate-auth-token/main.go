package main

import (
	"crypto/x509"
	"crypto/rsa"
    "crypto/sha256"
    "encoding/pem"
    "encoding/base64"
    "encoding/json"
    "math/big"
	"flag"
	"fmt"
	"os"
	"time"

    "data-generator/internal/cli"

	"github.com/golang-jwt/jwt/v5"
)

func main() {
	privateKeyPath := flag.String("private-key", "", "Path to the private key for JWT signing")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage of %s:\n", os.Args[0])
		flag.VisitAll(func(f *flag.Flag) {
			fmt.Fprintf(os.Stderr, "  --%s\n\t%s (default: %q)\n", f.Name, f.Usage, f.DefValue)
		})
	}

	flag.Parse()

	cli.ValidateRequiredFlags(map[string]string{
		"private-key": *privateKeyPath,
	}, flag.Usage)


	keyBytes, err := os.ReadFile(*privateKeyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Private key file does not exist or cannot be read at: %s\n", *privateKeyPath)
		os.Exit(1)
	}

	block, _ := pem.Decode(keyBytes)
	if block == nil {
		fmt.Fprintln(os.Stderr, "Error: Failed to parse PEM block from private key.")
		os.Exit(1)
	}

	privateKeyInterface, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		privateKeyInterface, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to parse private key: %v\n", err)
			os.Exit(1)
		}
	}

	rsaPrivateKey, ok := privateKeyInterface.(*rsa.PrivateKey)
	if !ok {
		fmt.Fprintln(os.Stderr, "Error: Key is not a valid RSA Private Key configuration.")
		os.Exit(1)
	}

	kid, err := computeJWKThumbprint(rsaPrivateKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error computing JWK thumbprint: %v\n", err)
		os.Exit(1)
	}

	claims := jwt.MapClaims{
		"iss":    "identity-link",
		"aud":    "identity-link",
		"sub":    "data-generator",
		"exp":    time.Now().Add(1 * time.Hour).Unix(),
		"groups": []string{"administrator"},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid

	tokenString, err := token.SignedString(rsaPrivateKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error signing token: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(tokenString)
}

func computeJWKThumbprint(priv *rsa.PrivateKey) (string, error) {
	pub := priv.PublicKey
	eBytes := big.NewInt(int64(pub.E)).Bytes()
	nBytes := pub.N.Bytes()

	jwkEssential := map[string]string{
		"e":   base64.RawURLEncoding.EncodeToString(eBytes),
		"kty": "RSA",
		"n":   base64.RawURLEncoding.EncodeToString(nBytes),
	}
	jsonBytes, err := json.Marshal(jwkEssential)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(jsonBytes)

	return base64.RawURLEncoding.EncodeToString(hash[:]), nil
}
