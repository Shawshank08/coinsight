"""Application configuration."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    bitcoin_csv_path: Path = Path("data/btcusd_1-min_data.csv")
    validation_fraction: float = 0.2
    interval_z_score: float = 1.96


settings = Settings()
