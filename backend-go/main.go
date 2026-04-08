package main

import (
	"log"
	"net/http"

	"coinsight/backend-go/routes"
)

func main() {
	// Bonus: start Binance WebSocket ticker in background
	routes.StartBinanceTicker()

	// ── Routes ────────────────────────────────────────────────────────────────
	http.HandleFunc("/predict", routes.PredictHandler)   // GET  — ML prediction (cached)
	http.HandleFunc("/retrain", routes.RetrainHandler)   // POST — trigger retrain
	http.HandleFunc("/history", routes.HistoryHandler)   // GET  — 30d OHLC from CoinGecko
	http.HandleFunc("/ws/ticker", routes.WSTickerHandler) // WS   — live Binance price feed

	log.Println("CoinSight Go backend running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
