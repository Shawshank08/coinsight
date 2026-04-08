package routes

import (
	"fmt"
	"net/http"

	"coinsight/backend-go/services"
)

// PredictHandler calls the ML service and returns a next-day price forecast.
// Responses are cached in Redis (or in-memory fallback) for 5 minutes.
func PredictHandler(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if handleOptions(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	const cacheKey = "prediction:xgboost"

	// ── Cache hit ─────────────────────────────────────────────────────────────
	if cached, ok := services.GetCachedPrediction(cacheKey); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.Write(cached)
		return
	}

	// ── Cache miss: call ML service ───────────────────────────────────────────
	body, status, err := services.CallML(http.MethodGet, "/predict")
	if err != nil || status != http.StatusOK {
		writeError(w, "ML service unavailable", http.StatusServiceUnavailable)
		return
	}

	services.SetCachedPrediction(cacheKey, body)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Cache", "MISS")
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

// RetrainHandler triggers model retraining on the ML service.
//
// Query params:
//
//	use_live_data=true  — append recent CoinGecko data before retraining
func RetrainHandler(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if handleOptions(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	useLiveData := r.URL.Query().Get("use_live_data")
	mlPath := "/retrain"
	if useLiveData == "true" {
		mlPath = fmt.Sprintf("/retrain?use_live_data=true")
	}

	body, status, err := services.CallML(http.MethodPost, mlPath)
	if err != nil {
		writeError(w, "ML service unavailable", http.StatusServiceUnavailable)
		return
	}

	// Invalidate cached predictions so next request gets fresh result
	services.InvalidatePredictionCache()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}
