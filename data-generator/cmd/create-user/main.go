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

	"data-generator/internal/cli"
	"data-generator/internal/api"
)

type UserPayload struct {
	Username     string   `json:"username"`
	Password     string   `json:"password"`
	FirstName    string   `json:"firstName"`
	LastName     string   `json:"lastName"`
	Email        string   `json:"email"`
	GrantTypes   []string `json:"grantTypes"`
	Groups       []string `json:"groups"`
	TwoFaEnabled bool     `json:"twoFaEnabled"`
}

func main() {
	groupName := flag.String("group", "", "Group name")
	username := flag.String("username", "", "Username")
	email := flag.String("email", "", "Email")
	password := flag.String("password", "", "Password")
	apiUrl := flag.String("api-url", "https://example.com/users/api/v1", "Base user API endpoint")
	authToken := flag.String("auth-token", "", "Bearer token for authorization")
    insecure := flag.Bool("insecure", false, "Skip TLS certificate verification")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage of %s:\n", os.Args[0])
		flag.VisitAll(func(f *flag.Flag) {
			fmt.Fprintf(os.Stderr, "  --%s\n\t%s (default: %q)\n", f.Name, f.Usage, f.DefValue)
		})
	}
	flag.Parse()

	cli.ValidateRequiredFlags(map[string]string{
		"group":      *groupName,
		"email":      *email,
		"username":   *username,
		"password":   *password,
		"api-url":    *apiUrl,
		"auth-token": *authToken,
	}, flag.Usage)

    httpClient := api.NewClient(*insecure)
    api.WaitForAPI(httpClient, "Client", *apiUrl);

	cleanApiUrl := strings.TrimSuffix(*apiUrl, "/")
	fmt.Fprintf(os.Stderr, "Checking group '%s'...\n", *groupName)
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

	// create group if it does not exist
	if groupID == "" {
		fmt.Fprintf(os.Stderr, "Creating group '%s'...\n", *groupName)
		gBody := map[string]string{"name": *groupName}
		gBytes, _ := json.Marshal(gBody)

		req, _ = http.NewRequest("POST", cleanApiUrl + "/group", bytes.NewBuffer(gBytes))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer " + *authToken)

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
		fmt.Fprintf(os.Stderr, "Created group: %s\n", groupID)
	} else {
		fmt.Fprintf(os.Stderr, "Group already exists: %s\n", groupID)
	}

	// create user
	fmt.Fprintf(os.Stderr, "Creating user '%s'...\n", *username)

	userPayload := UserPayload{
		Username:     *username,
		Password:     *password,
		FirstName:    "Firstname",
		LastName:     "Lastname",
		Email:        *email,
		GrantTypes:   []string{"password", "authorization_code", "refresh_token"},
		Groups:       []string{groupID},
		TwoFaEnabled: false,
	}
	userBytes, _ := json.Marshal(userPayload)

	req, _ = http.NewRequest("POST", cleanApiUrl + "/user", bytes.NewBuffer(userBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer " + *authToken)

	resp, err = httpClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		fmt.Fprintln(os.Stderr, "Failed to create user.")
		if resp != nil {
			io.Copy(os.Stderr, resp.Body)
			resp.Body.Close()
		}
		os.Exit(1)
	}
	resp.Body.Close()
	fmt.Fprintln(os.Stderr, "User created successfully.")

	fmt.Printf("USERNAME=%s\n", *username)
	fmt.Printf("PASSWORD=%s\n", *password)
}