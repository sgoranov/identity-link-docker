package api

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	RetryInterval = 3 * time.Second
	MaxRetries    = 10
)

func WaitForAPI(httpClient *http.Client, serviceName, rawApiUrl string) {
	cleanApiUrl := strings.TrimSuffix(rawApiUrl, "/")

	fmt.Fprintf(os.Stderr, "Waiting for %s/ping...\n", cleanApiUrl)
	attempts := 0

	for {
		resp, err := httpClient.Get(cleanApiUrl + "/ping")
		if err == nil && resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			fmt.Fprintf(os.Stderr, "%s API is up.\n", serviceName)
			return
		}
		if err == nil {
			resp.Body.Close()
		}

		attempts++
		if attempts >= MaxRetries {
			fmt.Fprintf(os.Stderr, "Error: Timed out waiting for %s API.\n", serviceName)
			os.Exit(1)
		}

		fmt.Fprintf(os.Stderr, "%s API not ready, retrying in %v...\n", serviceName, RetryInterval)
		time.Sleep(RetryInterval)
	}
}