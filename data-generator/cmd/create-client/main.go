package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"data-generator/internal/api"
	"data-generator/internal/cli"
)

type ClientPayload struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Audience    string   `json:"audience"`
	RedirectURI []string `json:"redirectUri"`
	GrantTypes  []string `json:"grantTypes"`
	Groups      []string `json:"groups"`
	IsPublic    bool     `json:"isPublic"`
}

type SecretPayload struct {
	PasswordHint     string `json:"passwordHint"`
	ExpirationPeriod string `json:"expirationPeriod"`
	Client           string `json:"client"`
}

func main() {
	groupName := flag.String("group", "", "Group name")
	clientName := flag.String("client", "", "Client name")
	audience := flag.String("audience", "", "Client audience")
	expirationPeriod := flag.String("exp-period", "", "Secret's expiration period (e.g., 1d, 1w, 1m, 3m, 9m, 1y or 2y)")
	redirectUrisRaw := flag.String("redirect-uris", "", "Comma-separated list of redirect URIs")
	apiUrl := flag.String("api-url", "https://example.com/clients/api/v1", "Base client API endpoint")
	authToken := flag.String("auth-token", "", "Bearer token")
	insecure := flag.Bool("insecure", false, "Skip TLS certificate verification")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage of %s:\n", os.Args[0])
		flag.VisitAll(func(f *flag.Flag) {
			fmt.Fprintf(os.Stderr, "  --%s\n\t%s (default: %q)\n", f.Name, f.Usage, f.DefValue)
		})
	}
	flag.Parse()

	cli.ValidateRequiredFlags(map[string]string{
		"group":            *groupName,
		"client":           *clientName,
		"audience":         *audience,
		"expirationPeriod": *expirationPeriod,
		"redirect-uris":    *redirectUrisRaw,
		"api-url":          *apiUrl,
		"authToken":        *authToken,
	}, flag.Usage)

	// validate the expiration period
	var allowedPeriods = map[string]struct{}{
		"1d": {}, "1w": {}, "1m": {}, "3m": {}, "9m": {}, "1y": {}, "2y": {},
	}
	if _, isValid := allowedPeriods[*expirationPeriod]; !isValid {
		fmt.Printf("Error: '%s' is not a valid period. Choose from 1d, 1w, 1m, 3m, 9m, 1y, 2y\n", *expirationPeriod)
		os.Exit(1)
	}

	httpClient := api.NewClient(*insecure)
	api.WaitForAPI(httpClient, "Client", *apiUrl)

	cleanApiUrl := strings.TrimSuffix(*apiUrl, "/")
	queryBody, _ := json.Marshal(api.QueryPayload{
		Type:       "Group",
		Query:      "t.name = :name",
		Parameters: map[string]string{"name": *groupName},
		Alias:      "t",
		Limit:      1,
	})

	req, _ := http.NewRequest("POST", cleanApiUrl+"/query", bytes.NewBuffer(queryBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+*authToken)

	resp, err := httpClient.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Query request failed: %v\n", err)
		os.Exit(1)
	}

	var qResp api.QueryResponse
	json.NewDecoder(resp.Body).Decode(&qResp)
	resp.Body.Close()

	var groupID string
	if len(qResp.Response.Result) > 0 {
		groupID = qResp.Response.Result[0].ID
	}

	if groupID == "" {
		gBody := map[string]string{"name": *groupName}
		gBytes, _ := json.Marshal(gBody)

		req, _ = http.NewRequest("POST", cleanApiUrl+"/group", bytes.NewBuffer(gBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+*authToken)

		resp, err = httpClient.Do(req)
		if err != nil || resp.StatusCode != http.StatusCreated {
			status := "unknown"
			if resp != nil {
				status = resp.Status
			}
			fmt.Fprintf(os.Stderr, "Failed to create group. Status: %s\n", status)
			os.Exit(1)
		}

		var createGroupResult map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&createGroupResult)
		resp.Body.Close()

		if respObj, ok := createGroupResult["response"].(map[string]interface{}); ok {
			if grpObj, ok := respObj["group"].(map[string]interface{}); ok {
				groupID = fmt.Sprintf("%v", grpObj["id"])
			}
		}
	}

	// create client
	var redirectUris []string
	for _, val := range strings.Split(*redirectUrisRaw, ",") {
		trimmed := strings.TrimSpace(val)
		if trimmed != "" {
			redirectUris = append(redirectUris, trimmed)
		}
	}

	clientPayload := ClientPayload{
		Name:        *clientName,
		Description: "description",
		Audience:    *audience,
		RedirectURI: redirectUris,
		GrantTypes:  []string{"client_credentials", "authorization_code", "password", "refresh_token"},
		Groups:      []string{groupID},
		IsPublic:    false,
	}
	clientBytes, _ := json.Marshal(clientPayload)

	req, _ = http.NewRequest("POST", cleanApiUrl+"/client", bytes.NewBuffer(clientBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+*authToken)

	resp, err = httpClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		fmt.Fprintln(os.Stderr, "Failed to create client.")
		if resp != nil {
			io.Copy(os.Stderr, resp.Body)
			resp.Body.Close()
		}
		os.Exit(1)
	}

	var createClientResult map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&createClientResult)
	resp.Body.Close()

	var clientID string
	if respObj, ok := createClientResult["response"].(map[string]interface{}); ok {
		if cltObj, ok := respObj["client"].(map[string]interface{}); ok {
			clientID = fmt.Sprintf("%v", cltObj["id"])
		}
	}

	// create client secret
	secretPayload := SecretPayload{
		PasswordHint:     "pass hint",
		ExpirationPeriod: *expirationPeriod,
		Client:           clientID,
	}
	secretBytes, _ := json.Marshal(secretPayload)

	req, _ = http.NewRequest("POST", cleanApiUrl+"/secret/issue", bytes.NewBuffer(secretBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+*authToken)

	resp, err = httpClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		status := "unknown"
		if resp != nil {
			status = resp.Status
			resp.Body.Close()
		}
		fmt.Fprintf(os.Stderr, "Failed to create client secret. Status: %s\n", status)
		os.Exit(1)
	}

	var createSecretResult map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&createSecretResult)
	resp.Body.Close()

	var clientSecret string
	if respObj, ok := createSecretResult["response"].(map[string]interface{}); ok {
		if secretObj, ok := respObj["secret"].(map[string]interface{}); ok {
			clientSecret = fmt.Sprintf("%v", secretObj["password"])
		}
	}

	fmt.Printf("CLIENT_ID=%s\n", clientID)
	fmt.Printf("CLIENT_SECRET=%s\n", clientSecret)
}
