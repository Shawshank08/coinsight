"""XGBoost regressor for next-day close with residual-based prediction intervals."""

from __future__ import annotations

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

from features import (
    MIN_SUPERVISED_ROWS,
    feature_columns,
    latest_feature_row,
    training_frame,
)


class BitcoinPriceModel:
    def __init__(
        self,
        validation_fraction: float = 0.2,
        interval_z_score: float = 1.96,
    ) -> None:
        self._validation_fraction = validation_fraction
        self._z = interval_z_score
        self._model: xgb.XGBRegressor | None = None
        self._feature_cols: list[str] = []
        self._residual_std: float = 0.0
        self.best_rmse: float = float("inf")

    def fit(self, daily_ohlcv: pd.DataFrame) -> dict[str, float]:
        train_table = training_frame(daily_ohlcv)
        self._feature_cols = sorted(feature_columns(train_table))
        if len(train_table) < MIN_SUPERVISED_ROWS:
            raise ValueError(
                f"Need at least {MIN_SUPERVISED_ROWS} supervised rows after features "
                f"(got {len(train_table)}); use more history in the CSV."
            )

        split = max(int(len(train_table) * (1.0 - self._validation_fraction)), 1)
        train_part = train_table.iloc[:split]
        val_part = train_table.iloc[split:]

        x_train = train_part[self._feature_cols]
        y_train = train_part["target_next_close"]
        x_val = val_part[self._feature_cols]
        y_val = val_part["target_next_close"]

        self._model = xgb.XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=-1,
        )
        self._model.fit(x_train, y_train, eval_set=[(x_val, y_val)], verbose=False)

        val_pred = self._model.predict(x_val)
        val_rmse = float(np.sqrt(mean_squared_error(y_val, val_pred)))
        self.best_rmse = val_rmse
        residuals = y_val.to_numpy() - val_pred
        self._residual_std = (
            float(np.std(residuals, ddof=1))
            if len(residuals) > 1
            else float(np.std(residuals))
        )

        return {
            "train_rows": float(len(train_part)),
            "val_rows": float(len(val_part)),
            "val_mae": float(mean_absolute_error(y_val, val_pred)),
            "val_rmse": val_rmse,
            "residual_std": self._residual_std,
        }

    def predict_next(self, daily_ohlcv: pd.DataFrame) -> tuple[float, float, float]:
        if self._model is None:
            raise RuntimeError("Model is not fitted.")

        x = latest_feature_row(daily_ohlcv)[self._feature_cols]
        pred = float(self._model.predict(x)[0])
        margin = self._z * self._residual_std
        lower = pred - margin
        upper = pred + margin
        return pred, lower, upper

    def retrain(self, daily_ohlcv: pd.DataFrame) -> dict:
        # Backup current model
        old_model = self._model
        old_residual_std = self._residual_std

        try:
            # Train new model
            result = self.fit(daily_ohlcv)

            new_rmse = result["val_rmse"]

            # If no previous model, accept new
            if old_model is None:
                return {"status": "updated", "rmse": new_rmse}

            # Compare RMSE (lower is better)
            if new_rmse < self.best_rmse:
                self.best_rmse = new_rmse
                return {"status": "updated", "rmse": new_rmse}
            else:
                # revert to old model
                self._model = old_model
                self._residual_std = old_residual_std
                return {"status": "kept_old", "rmse": new_rmse}

        except Exception as e:
            # revert on failure
            self._model = old_model
            self._residual_std = old_residual_std
            return {"status": "error", "message": str(e)}
