"""FastAPI service: train on startup, expose /predict for next-day close."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from config import settings
from data_loader import load_bitcoin_csv
from model import BitcoinPriceModel


class PredictionResponse(BaseModel):
    prediction: float = Field(description="Forecast next daily close (USD).")
    lower_bound: float = Field(description="Approximate lower bound (~95% if z=1.96).")
    upper_bound: float = Field(description="Approximate upper bound (~95% if z=1.96).")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        daily = load_bitcoin_csv(settings.bitcoin_csv_path)
    except FileNotFoundError as e:
        app.state.model_error = str(e)
        app.state.model = None
        yield
        return

    model = BitcoinPriceModel(
        validation_fraction=settings.validation_fraction,
        interval_z_score=settings.interval_z_score,
    )
    metrics = model.fit(daily)
    app.state.model = model
    app.state.daily = daily
    app.state.train_metrics = metrics
    app.state.model_error = None
    yield


app = FastAPI(title="CoinSight ML", lifespan=lifespan)


@app.get("/predict", response_model=PredictionResponse)
def predict() -> PredictionResponse:
    err = getattr(app.state, "model_error", None)
    if err:
        raise HTTPException(status_code=503, detail=err)

    model: BitcoinPriceModel = app.state.model
    daily = app.state.daily
    prediction, lower_bound, upper_bound = model.predict_next(daily)
    return PredictionResponse(
        prediction=prediction,
        lower_bound=lower_bound,
        upper_bound=upper_bound,
    )


@app.get("/health")
def health():
    if getattr(app.state, "model_error", None):
        return {"status": "degraded", "error": app.state.model_error}
    return {"status": "ok", "metrics": getattr(app.state, "train_metrics", {})}
