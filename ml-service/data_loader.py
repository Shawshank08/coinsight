"""Load and normalize Bitcoin OHLCV from the Kaggle historical CSV."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


KAGGLE_COLUMNS = ("Timestamp", "Open", "High", "Low", "Close", "Volume")


def load_bitcoin_csv(path: str | Path) -> pd.DataFrame:
    """
    Read mczielinski/bitcoin-historical-data (`btcusd_1-min_data.csv`).

    Resamples 1-minute rows to daily bars (last Close per UTC day) to keep
    training tractable and aligned with lag/rolling features.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(
            f"CSV not found: {path.resolve()}. "
            "Download from https://www.kaggle.com/datasets/mczielinski/bitcoin-historical-data/data "
            "and set BITCOIN_CSV_PATH if needed."
        )

    # Large file: read in chunks and aggregate to daily to bound memory use.
    chunk_rows = 500_000
    daily_parts: list[pd.DataFrame] = []

    usecols = list(KAGGLE_COLUMNS)
    for chunk in pd.read_csv(path, usecols=usecols, chunksize=chunk_rows):
        chunk = _normalize_chunk(chunk)
        if chunk.empty:
            continue
        # UTC day bucket for resampling inside this chunk
        day = chunk["Timestamp"].dt.floor("D")
        daily = chunk.groupby(day, sort=True).agg(
            Open=("Open", "first"),
            High=("High", "max"),
            Low=("Low", "min"),
            Close=("Close", "last"),
            Volume=("Volume", "sum"),
        )
        daily_parts.append(daily)

    if not daily_parts:
        raise ValueError("CSV contained no rows.")

    full_daily = pd.concat(daily_parts)
    full_daily = (
        full_daily.reset_index(names="Timestamp")
        .groupby("Timestamp", sort=True)
        .agg(
            Open=("Open", "first"),
            High=("High", "max"),
            Low=("Low", "min"),
            Close=("Close", "last"),
            Volume=("Volume", "sum"),
        )
    )
    full_daily = full_daily.sort_index()
    full_daily.index.name = "date"
    return full_daily.dropna(subset=["Close"])


def _normalize_chunk(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()
    missing = [c for c in KAGGLE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"CSV missing expected columns {missing}; found {list(df.columns)}")

    df["Timestamp"] = pd.to_datetime(df["Timestamp"], unit="s", utc=True, errors="coerce")
    for col in ("Open", "High", "Low", "Close", "Volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")

    return df.dropna(subset=["Timestamp", "Close"])
