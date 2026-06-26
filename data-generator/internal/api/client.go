package api

import (
	"crypto/tls"
	"net/http"
	"time"
)

func NewClient(skipTLS bool) *http.Client {
	httpClient := &http.Client{
		Timeout: 15 * time.Second,
	}

	if skipTLS {
		httpClient.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		}
	}

	return httpClient
}