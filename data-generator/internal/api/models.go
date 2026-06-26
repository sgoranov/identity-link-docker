package api

type QueryPayload struct {
	Type       string            `json:"type"`
	Query      string            `json:"query"`
	Parameters map[string]string `json:"parameters"`
	Alias      string            `json:"alias"`
	Limit      int               `json:"limit"`
}

type QueryResponse struct {
	Response struct {
		Result []struct {
			ID string `json:"id"`
		} `json:"result"`
	} `json:"response"`
}