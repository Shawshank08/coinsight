# PREMISE.md — Assumptions and Technical Decisions

---

## Data Sources

### Training Data

I used the Kaggle Bitcoin 1-minute dataset (`btcusd_1-min_data.csv`) for training. This file is a local snapshot from the date it was downloaded. The dataset maintainer updates the Kaggle source daily via a GitHub Actions workflow that pulls from Bitstamp, but that does not automatically update the local CSV — it stays at its download date unless you re-download it.

To address this, the `/retrain` endpoint supports `use_live_data=true`. When set, the ML service fetches the last 90 days of daily closes from CoinGecko, appends them to the existing training data (deduplicating by date), and retrains on the combined set. This keeps the model aware of recent price levels without requiring a full re-download of the Kaggle file.

### Historical Display Data

I used CoinGecko's `/coins/bitcoin/ohlc` endpoint for the 30-day candlestick chart. It returns real OHLCV data per candle, which is what the frontend needs for proper candlestick rendering.

I kept training data and display data as separate sources on purpose. The ML model benefits from years of historical price patterns across multiple market cycles. The frontend chart just needs recent data to be current. Using a 30-day API window for training would give the model too little history; using the full CSV for the chart would require users to download a 375MB file just to see a chart.

---

## Combined View Implementation

The specification asks for historical candlestick data stitched to the predicted line, with a range area for the confidence band.

ApexCharts does not support mixing `candlestick` and `rangeArea` series in the same chart — it silently drops one of them at render time. I implemented the equivalent using `chart.annotations`:

- A shaded y-axis band between `lower_bound` and `upper_bound` (range area equivalent)
- A dashed horizontal line at the predicted price with a USD label
- A vertical dashed line at tomorrow's date (the "stitch" point where history ends and forecast begins)
- Point markers at the last historical close and at the forecast point, visually connecting the two

The result is the same combined view: historical candles lead up to a marker, then the forecast extends forward with a price line and confidence band. The chart shows historical data immediately on page load; the forecast overlay appears only after clicking Get Prediction.

---

## Model: XGBoost

XGBoost was chosen because lag values and rolling averages are tabular features, which is exactly what gradient boosting is designed for. It trains in seconds on daily data, produces clean RMSE metrics, and has no system-level dependencies.

I attempted to implement Prophet as a second model for the model comparison bonus. Prophet's Stan optimizer crashes on Windows with exit code `0xC0000409` (stack buffer overflow in the pre-compiled binary) — this is a known incompatibility with certain Windows environments and is not fixable at the application level. I removed it rather than ship a feature that crashes on request. The model comparison bonus is documented here as attempted but excluded from the build.

---

## Retraining Strategy

The Q&A discussion introduced the question: if a retrained model performs worse than the current one, which do you keep? The answer is always the better-performing model.

The retrain flow:
1. New model trained on current dataset (with live data appended if requested)
2. New model's RMSE compared against `best_rmse` stored on the model instance
3. New model replaces old only if RMSE is lower
4. If worse, old model is automatically restored

This makes the Retrain button always safe — it cannot degrade the model.

---

## Redis Caching

Predictions are cached in Redis with a 5-minute TTL. The cache is invalidated immediately after every successful retrain so the next prediction comes from the updated model.

If Redis is not running, the service falls back to a thread-safe in-memory map with the same 5-minute TTL. The Go backend logs which mode is active at startup. Both modes behave identically from the frontend's perspective.

---

## Backend Structure

The Go backend is split into `routes/` and `services/`:

- `routes/` — one file per HTTP concern (predict, history, WebSocket)
- `services/` — shared logic (CoinGecko fetch, ML HTTP client, Redis cache)

`main.go` only registers routes and starts the server.

The CoinGecko history endpoint caches responses for 5 minutes and serves the last cached response if CoinGecko is temporarily unavailable — so the chart keeps working even when the external API is down.

If the Python ML service is down, the Go backend returns a clear error rather than stale or incorrect prediction data. Showing wrong data is worse than showing no data.

---

## WebSocket Live Ticker

The Go backend connects to Binance's `btcusdt@miniTicker` stream and fans updates out to all connected browser clients via a hub. Reconnects automatically if Binance drops the connection. The browser also reconnects every 3 seconds if the connection closes.

---

## Docker

All four services (Redis, ML, Go, Frontend) have Dockerfiles and a `docker-compose.yml`. The dataset is mounted as a volume rather than baked into the image because it is around 375MB and would make the image impractical to build.

---

## What I Would Do Next

- Implement Prophet model comparison on a Linux environment where the Stan binary works correctly
- Add proper unit tests for the feature engineering and RMSE comparison logic
- Use conformal prediction or quantile regression for more statistically rigorous confidence intervals — the current residual-based approach assumes normally distributed errors
- Store prediction history to track model accuracy over time
