"""Prophet model for next-day Bitcoin close — conservative forecast approach.

Prophet is the 'conservative' model: it captures long-term seasonal trends and
outputs native confidence intervals. XGBoost is the 'aggressive' model that
reacts more tightly to recent price momentum.

Windows / Stan note
-------------------
Prophet uses CmdStan under the hood. The most common crash on Windows is a
timezone-aware datetime column — Stan's optimizer receives malformed data and
raises RuntimeError. The _prepare() method strips timezone info explicitly.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

try:
    from prophet import Prophet
    from sklearn.metrics import mean_absolute_error, mean_squared_error

    PROPHET_AVAILABLE = True
except ImportError:
    PROPHET_AVAILABLE = False


class ProphetPriceModel:
    """Wraps Meta Prophet for next-day Bitcoin price forecasting.

    Uses the most recent 365 days (1 year) rather than 2 years because:
    - Bitcoin price dynamics shift significantly across market cycles
    - Shorter window trains faster (~10-30 s vs ~60 s on Windows)
    - Avoids feeding Stan optimizer data from very different price regimes
    """

    TRAINING_DAYS = 365

    def __init__(self, interval_width: float = 0.95) -> None:
        if not PROPHET_AVAILABLE:
            raise RuntimeError("Prophet is not installed. Run: pip install prophet")
        self._interval_width = interval_width
        self._model: "Prophet | None" = None
        self.best_rmse: float = float("inf")

    # ── Public interface ──────────────────────────────────────────────────────

    def fit(self, daily_ohlcv: pd.DataFrame) -> dict[str, float]:
        """Train on the last TRAINING_DAYS of daily closes, hold out 20%."""
        df = self._prepare(daily_ohlcv)

        if len(df) < 30:
            raise ValueError(
                f"Need at least 30 daily rows for Prophet (got {len(df)})."
            )

        split = max(int(len(df) * 0.8), 1)
        train_df = df.iloc[:split].copy()
        val_df = df.iloc[split:].copy()

        log.info("Prophet fitting on %d rows (val: %d)…", len(train_df), len(val_df))

        # Validation model — metrics only, not stored
        val_model = self._build_model()
        val_model.fit(train_df)
        future_val = val_model.make_future_dataframe(periods=len(val_df))
        forecast_val = val_model.predict(future_val)
        val_pred = forecast_val.iloc[-len(val_df) :]["yhat"].values

        rmse = float(np.sqrt(mean_squared_error(val_df["y"].values, val_pred)))
        mae = float(mean_absolute_error(val_df["y"].values, val_pred))
        self.best_rmse = rmse
        log.info("Prophet validation RMSE: %.2f  MAE: %.2f", rmse, mae)

        # Production model trained on all available data
        self._model = self._build_model()
        self._model.fit(df)

        return {
            "train_rows": float(len(train_df)),
            "val_rows": float(len(val_df)),
            "val_rmse": rmse,
            "val_mae": mae,
        }

    def predict_next(self, daily_ohlcv: pd.DataFrame) -> tuple[float, float, float]:
        """Return (prediction, lower_bound, upper_bound) for the next day."""
        if self._model is None:
            raise RuntimeError("ProphetPriceModel is not fitted.")

        future = self._model.make_future_dataframe(periods=1)
        forecast = self._model.predict(future)
        last = forecast.iloc[-1]
        return (
            float(last["yhat"]),
            float(last["yhat_lower"]),
            float(last["yhat_upper"]),
        )

    def retrain(self, daily_ohlcv: pd.DataFrame) -> dict:
        """Retrain and keep the new model only if RMSE improves."""
        old_model = self._model
        old_rmse = self.best_rmse

        try:
            result = self.fit(daily_ohlcv)
            new_rmse = result["val_rmse"]

            if old_model is None or new_rmse < old_rmse:
                return {"status": "updated", "rmse": new_rmse}

            # Revert — old model had better RMSE
            self._model = old_model
            self.best_rmse = old_rmse
            return {"status": "kept_old", "rmse": new_rmse}

        except Exception as exc:  # noqa: BLE001
            self._model = old_model
            self.best_rmse = old_rmse
            return {"status": "error", "message": str(exc)}

    @staticmethod
    def is_available() -> bool:
        return PROPHET_AVAILABLE

    # ── Private helpers ───────────────────────────────────────────────────────

    def _prepare(self, daily_ohlcv: pd.DataFrame) -> pd.DataFrame:
        """Convert OHLCV DataFrame → Prophet ds/y format.

        Critical: Prophet's Stan optimizer crashes if ds is timezone-aware.
        We strip tz info here unconditionally.
        """
        raw = daily_ohlcv.reset_index()

        # The index column may be named 'date', 'Timestamp', or 'index'
        date_col = None
        for candidate in ("date", "Timestamp", "index"):
            if candidate in raw.columns:
                date_col = candidate
                break

        if date_col is None:
            raise ValueError(
                f"Cannot find date column in DataFrame. Columns: {list(raw.columns)}"
            )

        df = raw[[date_col, "Close"]].rename(columns={date_col: "ds", "Close": "y"})
        df = df.dropna()

        # ── CRITICAL FIX: strip timezone so Stan doesn't crash ──────────────
        df["ds"] = pd.to_datetime(df["ds"])
        if hasattr(df["ds"].dt, "tz") and df["ds"].dt.tz is not None:
            df["ds"] = df["ds"].dt.tz_localize(None)

        df = df.sort_values("ds").reset_index(drop=True)

        # Use only the most recent TRAINING_DAYS rows
        return df.iloc[-self.TRAINING_DAYS :].reset_index(drop=True)

    def _build_model(self) -> "Prophet":
        return Prophet(
            interval_width=self._interval_width,
            daily_seasonality=False,
            weekly_seasonality=True,
            yearly_seasonality=True,
            # Conservative — less sensitive to sharp price moves
            changepoint_prior_scale=0.05,
        )
