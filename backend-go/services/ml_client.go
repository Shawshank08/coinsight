package services

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// MLBaseURL is the address of the Python FastAPI service.
// Override with the ML_BASE_URL environment variable when using Docker.
var MLBaseURL = func() string {
	if url := envOrDefault("ML_BASE_URL", ""); url != "" {
		return url
	}
	return "http://localhost:8000"
}()

var mlHTTPClient = &http.Client{Timeout: 30 * time.Second}

// CallML sends a request to the ML service and returns the raw response body
// along with the HTTP status code. Callers are responsible for interpreting
// the response.
func CallML(method, path string) ([]byte, int, error) {
	req, err := http.NewRequest(method, MLBaseURL+path, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("ml_client: build request: %w", err)
	}

	resp, err := mlHTTPClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("ml_client: do request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("ml_client: read body: %w", err)
	}

	return body, resp.StatusCode, nil
}

// envOrDefault returns the value of an environment variable or a default.
func envOrDefault(key, def string) string {
	if v := getEnv(key); v != "" {
		return v
	}
	return def
}
