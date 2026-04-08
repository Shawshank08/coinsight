package routes

import (
	"encoding/json"
	"net/http"

	"coinsight/backend-go/services"
)

// HistoryHandler returns 30 days of Bitcoin OHLC data from CoinGecko.
// Results are cached in memory for 5 minutes. If CoinGecko is temporarily
// unavailable the handler serves the last successful response (stale-while-error).
func HistoryHandler(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if handleOptions(w, r) {
		return
	}

	data, err := services.GetCachedOHLC()
	if err != nil {
		writeError(w, "failed to fetch historical data", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}
