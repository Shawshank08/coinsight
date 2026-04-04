package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

const mlPredictURL = "http://localhost:8000/predict"

var mlClient = &http.Client{Timeout: 2 * time.Second}

func main() {
	http.HandleFunc("/predict", predictHandler)
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func predictHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, mlPredictURL, nil)
	if err != nil {
		writeMLError(w)
		return
	}

	resp, err := mlClient.Do(req)
	if err != nil {
		writeMLError(w)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeMLError(w)
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	} else {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

func writeMLError(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "ML service unavailable"})
}
