# CoinSight — Bitcoin Price Prediction Engine

CoinSight is a full-stack system that predicts the next day's Bitcoin closing price using XGBoost and displays it alongside 30 days of live candlestick data, a 95% confidence band stitched directly to the last historical candle, and a real-time price ticker from Binance.

---

## Architecture

```
Browser (React + Vite)
        │
        ├── REST ──► Go Backend (port 8080)
        │               ├── /predict   ──► Python ML Service (port 8000)
        │               ├── /retrain   ──► Python ML Service
        │               └── /history   ──► CoinGecko API (cached 5 min)
        │
        └── WebSocket /ws/ticker ──► Go ──► Binance live stream
```

- **Frontend** — React + ApexCharts. Shows 30-day candlestick history on page load. After clicking Get Prediction, overlays the forecast and confidence band directly on the chart using annotations, and shows prediction cards with percentage change.
- **Go Backend** — Orchestrator. Routes all API calls, caches predictions in Redis (5-min TTL, falls back to in-memory if Redis is not running), fans out Binance WebSocket to all browser clients.
- **Python ML Service** — FastAPI + XGBoost. Trains on startup from the Kaggle CSV, exposes predict/retrain/health endpoints.

---

## Running Without Docker (3 terminals)

### Prerequisites
- Go 1.21+
- Python 3.10+
- Node.js 18+
- Redis (optional — prediction caching falls back to in-memory without it)
- Bitcoin historical CSV: [download from Kaggle](https://www.kaggle.com/datasets/mczielinski/bitcoin-historical-data/data)
  - Place `btcusd_1-min_data.csv` at `ml-service/data/btcusd_1-min_data.csv`

### Terminal 1 — Python ML Service
```bash
cd ml-service
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```
The service resamples the full CSV on startup (30–60 seconds first time). Check `http://localhost:8000/health` before making prediction requests.

### Terminal 2 — Go Backend
```bash
cd backend-go
go mod tidy        # only needed once
go run main.go
```

### Terminal 3 — Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`.

---

## Running With Docker

```bash
docker-compose up --build
```

Starts Redis, ML service, Go backend, and frontend together. The ML service has a 120-second health check window for training.

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Go Backend | http://localhost:8080 |
| ML Service | http://localhost:8000 |
| Redis | localhost:6379 |

---

## API Reference

### Go Backend

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/predict` | Next-day XGBoost forecast (Redis cached 5 min) |
| POST | `/retrain?use_live_data=true` | Retrain, optionally appending live CoinGecko data |
| GET | `/history` | 30-day OHLC candlestick data (cached 5 min) |
| WS | `/ws/ticker` | Binance live BTCUSDT price stream |

### Python ML Service

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/predict` | Prediction + 95% confidence interval |
| POST | `/retrain?use_live_data=true` | Retrain with RMSE comparison |
| GET | `/health` | Model status, RMSE, MAE |

### Prediction Response
```json
{
  "prediction": 72400.00,
  "lower_bound": 48200.00,
  "upper_bound": 96600.00
}
```

### API Communication Flow

1. User clicks **Get Prediction**
2. Frontend → `GET /predict` → Go backend
3. Go checks Redis. Cache hit → returns immediately with `X-Cache: HIT`
4. Cache miss → Go → `GET /predict` → Python ML service → prediction computed
5. Go caches result in Redis (5-min TTL), returns to frontend
6. Frontend overlays forecast on the candlestick chart as: dashed prediction line with USD label, shaded confidence band (range area), dot markers at last historical close and forecast point

---

## Machine Learning

**Training data:** Kaggle `btcusd_1-min_data.csv` — 1-minute OHLCV data resampled to daily bars. The local CSV is a snapshot from the download date. To supplement it with recent prices, use the Retrain with live data option, which fetches the last 90 days from CoinGecko and appends them to the training set before fitting.

**Features:**
- Lag values: closing prices from 1, 2, 3, 7, and 14 days ago
- Rolling averages: 7-day and 14-day moving averages of close price

**Model:** XGBoost regressor, 80/20 temporal train-validation split

**Evaluation:** RMSE and MAE on the validation set (visible at `/health`)

**Confidence interval:** Residual standard deviation × 1.96 ≈ 95% band. This can be wide due to Bitcoin’s high volatility.

**Retrain safety:** New model RMSE is compared to current best. Old model is kept if the new one is worse — retraining never degrades the model.

---

## Bonus Features

| Feature | Where |
|---------|-------|
| WebSocket live Binance ticker (BTCUSDT) | `routes/ws.go` + `App.jsx` |
| Redis prediction caching (5-min TTL) | `services/redis_cache.go` |
| In-memory fallback when Redis is not running | `services/redis_cache.go` |
| Retrain with incoming live CoinGecko data | `app.py` + `routes/predict.go` |
| Cache invalidation after retrain | `services/redis_cache.go` |

---

## Project Structure

```
coinsight/
├── ml-service/
│   ├── app.py              # FastAPI routes, startup, retrain with live data
│   ├── model.py            # XGBoost, RMSE comparison, retrain logic
│   ├── features.py         # Lag values + rolling averages
│   ├── data_loader.py      # Chunked CSV loading + daily resampling
│   ├── config.py           # Pydantic settings
│   ├── requirements.txt
│   └── Dockerfile
├── backend-go/
│   ├── main.go             # Entry point
│   ├── routes/
│   │   ├── predict.go      # /predict + /retrain with Redis cache
│   │   ├── history.go      # /history
│   │   ├── ws.go           # WebSocket hub + Binance stream
│   │   └── helpers.go      # CORS + error helpers
│   ├── services/
│   │   ├── ml_client.go    # HTTP client for ML calls
│   │   ├── coingecko.go    # OHLC fetch + stale fallback
│   │   ├── redis_cache.go  # Redis + in-memory cache
│   │   └── env.go
│   ├── go.mod
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx   # Shell + live Binance ticker
│   │   └── pages/
│   │       ├── Home.jsx  # Chart, predictions, retrain
│   │       └── Home.css
│   └── Dockerfile
├── docker-compose.yml
├── .gitignore
├── README.md
└── PREMISE.md
```
