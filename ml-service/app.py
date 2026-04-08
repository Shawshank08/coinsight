"""CoinSight ML service — XGBoost next-day Bitcoin price forecast.

Endpoints
---------
GET  /predict                        — next-day forecast + 95% CI
POST /retrain?use_live_data=true     — retrain with optional live CoinGecko data
GET  /health                         — model status, RMSE, MAE
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from config import settings
from data_loader import load_bitcoin_csv
from model import BitcoinPriceModel

log = logging.getLogger(__name__)


# ── Response model ─────────────────────────────────────────────────────────────

class PredictionResponse(BaseModel):
    prediction: float = Field(description="Next-day close forecast (USD).")
    lower_bound: float = Field(description="95% confidence lower bound.")
    upper_bound: float = Field(description="95% confidence upper bound.")


# ── Startup ────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        daily = load_bitcoin_csv(settings.bitcoin_csv_path)
    except FileNotFoundError as exc:
        app.state.model_error = str(exc)
        app.state.model = None
        app.state.daily = None
        yield
        return

    model = BitcoinPriceModel(
        validation_fraction=settings.validation_fraction,
        interval_z_score=settings.interval_z_score,
    )
    metrics = model.fit(daily)
    log.info("XGBoost trained — RMSE: %.2f  MAE: %.2f",
             metrics["val_rmse"], metrics["val_mae"])

    app.state.model = model
    app.state.daily = daily
    app.state.train_metrics = metrics
    app.state.model_error = None
    yield


app = FastAPI(title="CoinSight ML", lifespan=lifespan)


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _fetch_live_daily(days: int = 90) -> pd.DataFrame | None:
    """Fetch recent daily closes from CoinGecko and return as OHLCV DataFrame.
    Used by the retrain endpoint when use_live_data=true.
    """
    url = (
        f"https://api.coingecko.com/api/v3/coins/bitcoin/market_chart"
        f"?vs_currency=usd&days={days}&interval=daily"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
        resp.raise_for_status()
        prices = resp.json().get("prices", [])
        if not prices:
            return None

        df = pd.DataFrame(prices, columns=["ts", "Close"])
        df["date"] = pd.to_datetime(df["ts"], unit="ms", utc=True).dt.normalize()
        df = df.set_index("date")[["Close"]]
        df["Open"] = df["Close"]
        df["High"] = df["Close"]
        df["Low"]  = df["Close"]
        df["Volume"] = 0.0
        return df[["Open", "High", "Low", "Close", "Volume"]]
    except Exception as exc:  # noqa: BLE001
        log.warning("CoinGecko live data fetch failed: %s", exc)
        return None


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/predict", response_model=PredictionResponse)
def predict() -> PredictionResponse:
    err = getattr(app.state, "model_error", None)
    if err:
        raise HTTPException(status_code=503, detail=err)

    model: BitcoinPriceModel = app.state.model
    prediction, lower_bound, upper_bound = model.predict_next(app.state.daily)
    return PredictionResponse(
        prediction=prediction,
        lower_bound=lower_bound,
        upper_bound=upper_bound,
    )


@app.post("/retrain")
async def retrain(
    use_live_data: bool = Query(default=False),
):
    """Retrain the XGBoost model.

    Pass use_live_data=true to append recent CoinGecko daily closes to the
    training dataset before fitting. The new model is only kept if its
    validation RMSE is better than the current model.
    """
    err = getattr(app.state, "model_error", None)
    if err:
        raise HTTPException(status_code=503, detail=err)

    daily = app.state.daily

    if use_live_data:
        log.info("Fetching live data from CoinGecko before retrain…")
        live_df = await _fetch_live_daily(days=90)
        if live_df is not None:
            combined = pd.concat([daily, live_df])
            combined = combined[~combined.index.duplicated(keep="last")].sort_index()
            daily = combined
            app.state.daily = daily
            log.info("Appended %d live rows to training data", len(live_df))
        else:
            log.warning("Live data unavailable — retraining on existing dataset")

    model: BitcoinPriceModel = app.state.model
    result = model.retrain(daily)

    return {
        "status": result.get("status"),
        "rmse": result.get("rmse"),
        "used_live_data": use_live_data,
        "message": result.get("message", ""),
    }


@app.get("/health")
def health():
    err = getattr(app.state, "model_error", None)
    if err:
        return {"status": "degraded", "error": err}

    model: BitcoinPriceModel = app.state.model
    return {
        "status": "ok",
        "model": "xgboost",
        "rmse": model.best_rmse if model else None,
        "metrics": getattr(app.state, "train_metrics", {}),
    }
