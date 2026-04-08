package services

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

// OHLCPoint represents one candlestick bar from CoinGecko.
type OHLCPoint struct {
	Time  int64   `json:"time"`
	Open  float64 `json:"open"`
	High  float64 `json:"high"`
	Low   float64 `json:"low"`
	Close float64 `json:"close"`
}

var (
	cachedOHLC    []OHLCPoint
	ohlcFetchedAt time.Time
	ohlcMu        sync.RWMutex
	ohlcTTL       = 5 * time.Minute
)

// GetCachedOHLC returns OHLC data, refreshing from CoinGecko when the cache expires.
// If CoinGecko is unavailable it returns the last known data rather than failing.
func GetCachedOHLC() ([]OHLCPoint, error) {
	ohlcMu.RLock()
	fresh := time.Since(ohlcFetchedAt) < ohlcTTL && cachedOHLC != nil
	ohlcMu.RUnlock()

	if fresh {
		ohlcMu.RLock()
		defer ohlcMu.RUnlock()
		return cachedOHLC, nil
	}

	data, err := fetchOHLC()
	if err != nil {
		ohlcMu.RLock()
		defer ohlcMu.RUnlock()
		if cachedOHLC != nil {
			log.Printf("[coingecko] fetch failed (%v); serving stale cache", err)
			return cachedOHLC, nil
		}
		return nil, err
	}

	ohlcMu.Lock()
	cachedOHLC = data
	ohlcFetchedAt = time.Now()
	ohlcMu.Unlock()

	return data, nil
}

// fetchOHLC calls the CoinGecko /ohlc endpoint and parses the response.
// CoinGecko returns [[timestamp_ms, open, high, low, close], ...].
func fetchOHLC() ([]OHLCPoint, error) {
	const url = "https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=30"

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var raw [][]float64
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	points := make([]OHLCPoint, 0, len(raw))
	for _, c := range raw {
		if len(c) < 5 {
			continue
		}
		points = append(points, OHLCPoint{
			Time:  int64(c[0]),
			Open:  c[1],
			High:  c[2],
			Low:   c[3],
			Close: c[4],
		})
	}
	return points, nil
}
