"""Feature engineering: lags and rolling statistics on the daily close."""

from __future__ import annotations

import pandas as pd

LAG_PERIODS: tuple[int, ...] = (1, 2, 3, 7, 14)
ROLL_WINDOWS: tuple[int, ...] = (7, 14)

# Minimum supervised rows after dropna (lags, rolling windows, and next-day target).
MIN_SUPERVISED_ROWS: int = max(LAG_PERIODS) + max(ROLL_WINDOWS) + 15


def add_features(df: pd.DataFrame, price_col: str = "Close") -> pd.DataFrame:
    """Return a copy of `df` with lag and rolling-average columns."""
    out = df.copy()
    close = out[price_col]

    for lag in LAG_PERIODS:
        out[f"close_lag_{lag}"] = close.shift(lag)

    for window in ROLL_WINDOWS:
        out[f"close_roll_mean_{window}"] = close.rolling(window, min_periods=window).mean()

    return out


def feature_columns(df: pd.DataFrame) -> list[str]:
    """Column names used as model inputs (excludes raw OHLCV and target)."""
    return [c for c in df.columns if c.startswith("close_lag_") or c.startswith("close_roll_mean_")]


def add_target_next_close(df: pd.DataFrame, price_col: str = "Close") -> pd.DataFrame:
    """Next-period close for supervised training."""
    out = df.copy()
    out["target_next_close"] = out[price_col].shift(-1)
    return out


def training_frame(df: pd.DataFrame, price_col: str = "Close") -> pd.DataFrame:
    """Features + target; drops rows with incomplete history or missing target."""
    framed = add_target_next_close(add_features(df, price_col), price_col)
    cols = feature_columns(framed) + ["target_next_close"]
    return framed[cols].dropna()


def latest_feature_row(df: pd.DataFrame, price_col: str = "Close") -> pd.DataFrame:
    """
    Single-row feature vector for the most recent date (predict next close).

    Uses the same feature definitions as training; drops the last row if
    target would be used only for training alignment — here we only need
    the last row where all lags and rolls are defined.
    """
    framed = add_features(df, price_col)
    cols = feature_columns(framed)
    ready = framed[cols].dropna()
    if ready.empty:
        raise ValueError("Not enough history to build features (need max lag/roll window).")
    return ready.iloc[[-1]]
