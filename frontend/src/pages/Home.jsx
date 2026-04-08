import { useState, useCallback, useMemo, useEffect } from "react";
import Chart from "react-apexcharts";
import "./Home.css";

const BASE = "http://localhost:8080";

function parsePredictionNumber(v) {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function formatUsd(n) {
  const num = typeof n === "number" && Number.isFinite(n) ? n : parseFloat(String(n));
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

function Arrow({ up }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
      style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }}>
      <path d={up ? "M7 11V3M3 7l4-4 4 4" : "M7 3v8M3 7l4 4 4-4"}
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [retraining, setRetraining] = useState(false);
  const [error, setError] = useState(null);
  const [retrainResult, setRetrainResult] = useState(null);
  const [useLiveData, setUseLiveData] = useState(false);

  const [prediction, setPrediction] = useState(null);
  const [lowerBound, setLowerBound] = useState(null);
  const [upperBound, setUpperBound] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(false);

  // ── Fetch history immediately on mount ────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setHistoryError(false);
    try {
      const res = await fetch(`${BASE}/history`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) setHistory(data);
      else setHistoryError(true);
    } catch { setHistoryError(true); }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ── Get prediction ─────────────────────────────────────────────────────────
  const getPrediction = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/predict`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || "Request failed"); return; }
      const pred = parsePredictionNumber(data.prediction);
      const lower = parsePredictionNumber(data.lower_bound);
      const upper = parsePredictionNumber(data.upper_bound);
      if (pred === null || lower === null || upper === null) {
        setError("Invalid prediction data"); return;
      }
      setPrediction(pred);
      setLowerBound(lower);
      setUpperBound(upper);
    } catch { setError("Could not reach the server"); }
    finally { setLoading(false); }
  }, []);

  // ── Retrain ────────────────────────────────────────────────────────────────
  const triggerRetrain = useCallback(async () => {
    setRetraining(true);
    setRetrainResult(null);
    setError(null);
    try {
      const res = await fetch(`${BASE}/retrain?use_live_data=${useLiveData}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || "Retrain failed"); return; }
      setRetrainResult(data);
      setPrediction(null); setLowerBound(null); setUpperBound(null);
    } catch { setError("Could not reach the server"); }
    finally { setRetraining(false); }
  }, [useLiveData]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasResult =
    typeof prediction === "number" && Number.isFinite(prediction) &&
    typeof lowerBound === "number" && Number.isFinite(lowerBound) &&
    typeof upperBound === "number" && Number.isFinite(upperBound);

  const lastClose = history.length > 0 ? history[history.length - 1].close : null;
  const lastTime = history.length > 0 ? history[history.length - 1].time : null;
  const isUp = hasResult && lastClose !== null ? prediction >= lastClose : null;

  // ── Chart ──────────────────────────────────────────────────────────────────
  const candleSeries = useMemo(
    () => [{
      name: "BTC / USD",
      data: history.map((p) => ({
        x: new Date(Number(p.time)).getTime(),
        y: [p.open, p.high, p.low, p.close],
      })),
    }],
    [history]
  );

  const forecastTime = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  // ── Annotations: stitch last candle → prediction ───────────────────────────
  // ApexCharts cannot mix candlestick + rangeArea series (it silently drops one).
  // Instead we use chart.annotations to overlay the forecast on the candlestick:
  //   • yaxis band  → shaded confidence interval (range area equivalent)
  //   • yaxis line  → predicted price with label (prediction line)
  //   • xaxis line  → tomorrow's date marker (the "stitch" point)
  //   • point       → dot at last close → prediction, visually connecting the two
  const annotations = useMemo(() => {
    if (!hasResult) return { xaxis: [], yaxis: [], points: [] };

    const pts = [];

    // Dot on the last historical close — start of the "stitched" forecast line
    if (lastTime && lastClose) {
      pts.push({
        x: new Date(Number(lastTime)).getTime(),
        y: lastClose,
        marker: {
          size: 5,
          fillColor: "#7c3aed",
          strokeColor: "#fff",
          strokeWidth: 2,
          radius: 3,
        },
        label: { text: "" },
      });
    }

    // Dot at the forecast point
    pts.push({
      x: forecastTime,
      y: prediction,
      marker: {
        size: 6,
        fillColor: "#7c3aed",
        strokeColor: "#fff",
        strokeWidth: 2,
        radius: 3,
      },
      label: { text: "" },
    });

    return {
      xaxis: [{
        x: forecastTime,
        borderColor: "#a855f7",
        borderWidth: 2,
        strokeDashArray: 5,
        label: {
          text: "Forecast",
          position: "left",
          offsetX: -4,
          style: {
            color: "#fff", background: "#7c3aed",
            fontSize: "11px", fontWeight: 600,
            padding: { top: 4, bottom: 4, left: 8, right: 8 },
            borderRadius: 4,
          },
        },
      }],
      yaxis: [
        // Range area equivalent — shaded confidence band
        {
          y: lowerBound,
          y2: upperBound,
          fillColor: "#a855f7",
          opacity: 0.15,
          label: { text: "" },
        },
        // Predicted price line
        {
          y: prediction,
          borderColor: "#7c3aed",
          borderWidth: 2,
          strokeDashArray: 4,
          label: {
            text: formatUsd(prediction),
            position: "right",
            style: {
              color: "#fff", background: "#7c3aed",
              fontSize: "11px", fontWeight: 600,
              padding: { top: 4, bottom: 4, left: 8, right: 8 },
              borderRadius: 4,
            },
          },
        },
      ],
      points: pts,
    };
  }, [hasResult, forecastTime, prediction, lowerBound, upperBound, lastTime, lastClose]);

  const chartOptions = useMemo(() => ({
    chart: {
      type: "candlestick",
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
      animations: { enabled: true, speed: 400 },
      background: "transparent",
    },
    annotations,
    plotOptions: {
      candlestick: {
        colors: { upward: "#26a69a", downward: "#ef5350" },
        wick: { useFillColor: true },
      },
    },
    dataLabels: { enabled: false },
    xaxis: {
      type: "datetime",
      labels: { datetimeUTC: false, style: { colors: "#9ca3af", fontSize: "11px" } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      min: Math.min(
        ...history.map(d => d.low ?? d.y?.[2]),
        lowerBound ?? Infinity,
        prediction ?? Infinity
      ) * 0.98,

      max: Math.max(
        ...history.map(d => d.high ?? d.y?.[1]),
        upperBound ?? -Infinity,
        prediction ?? -Infinity
      ) * 1.02,

      labels: {
        formatter: (val) => formatUsd(val),
        style: { colors: "#9ca3af", fontSize: "11px" },
      },

      tooltip: { enabled: true },
    },
    grid: {
      borderColor: "#2e303a",
      strokeDashArray: 4,
      padding: { left: 4, right: 16 },
    },
    tooltip: {
      theme: "dark",
      style: { fontSize: "12px" },
      x: { format: "dd MMM yyyy" },
    },
    theme: { mode: "dark" },
  }), [annotations]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cs-page">

      {/* ── Top row ──────────────────────────────────────── */}
      <div className="cs-toprow">
        <div className="cs-title-group">
          {/* Title changes based on prediction state */}
          {hasResult ? (
            <>
              <h2 className="cs-title">Bitcoin · Next-Day Forecast</h2>
              <span className="cs-subtitle">XGBoost · 95% confidence interval · 30-day OHLC</span>
            </>
          ) : (
            <>
              <h2 className="cs-title">Bitcoin / USD</h2>
              <span className="cs-subtitle">30-day candlestick · Binance live feed</span>
            </>
          )}
        </div>
        <div className="cs-actions">
          <button className="cs-btn cs-btn-primary" onClick={getPrediction} disabled={loading || retraining}>
            {loading ? <><span className="cs-spinner" />Fetching…</> : "Get Prediction"}
          </button>
          <div className="cs-retrain-group">
            <button className="cs-btn cs-btn-secondary" onClick={triggerRetrain}
              disabled={loading || retraining}
              title="Retrain XGBoost. Old model kept if new RMSE is worse.">
              {retraining ? <><span className="cs-spinner" />Retraining…</> : "Retrain Model"}
            </button>
            <label className="cs-live-toggle" title="Append recent CoinGecko data before retraining">
              <input type="checkbox" checked={useLiveData}
                onChange={(e) => setUseLiveData(e.target.checked)} />
              <span>Use live data</span>
            </label>
          </div>
        </div>
      </div>

      {/* ── Banners ───────────────────────────────────────── */}
      {error && (
        <div className="cs-banner cs-banner-error" role="alert">⚠ {error}</div>
      )}
      {retrainResult && !error && (
        <div className={`cs-banner ${retrainResult.status === "updated" ? "cs-banner-success" : "cs-banner-info"}`}
          role="status">
          {retrainResult.status === "updated"
            ? `✅ Model updated — new RMSE: ${formatUsd(retrainResult.rmse)}`
            : `ℹ Existing model kept (lower RMSE was better) — RMSE: ${formatUsd(retrainResult.rmse)}`}
          {retrainResult.used_live_data && " · Used live CoinGecko data"}
        </div>
      )}

      {/* ── Prediction cards — only shown after Get Prediction ─── */}
      {hasResult && (
        <div className="cs-cards">
          <div className="cs-card cs-card-main">
            <span className="cs-card-label">Predicted Close · XGBoost</span>
            <span className={`cs-card-value ${isUp ? "cs-up" : "cs-down"}`}>
              <Arrow up={isUp} />{formatUsd(prediction)}
            </span>
            {lastClose && (
              <span className="cs-card-delta">
                vs last close {formatUsd(lastClose)}
                <span className={isUp ? "cs-up" : "cs-down"}>
                  {" "}({isUp ? "+" : ""}{((prediction - lastClose) / lastClose * 100).toFixed(2)}%)
                </span>
              </span>
            )}
          </div>
          <div className="cs-card">
            <span className="cs-card-label">95% Lower Bound</span>
            <span className="cs-card-value cs-neutral">{formatUsd(lowerBound)}</span>
            <span className="cs-card-delta">Worst-case estimate</span>
          </div>
          <div className="cs-card">
            <span className="cs-card-label">95% Upper Bound</span>
            <span className="cs-card-value cs-neutral">{formatUsd(upperBound)}</span>
            <span className="cs-card-delta">Best-case estimate</span>
          </div>
        </div>
      )}

      {/* ── Chart — always visible from page load ─────────── */}
      <div className="cs-chart-wrap">
        {historyError && !history.length ? (
          <div className="cs-chart-error">
            Could not load historical data — is the Go backend running on port 8080?
          </div>
        ) : (
          <Chart
            key={hasResult ? "annotated" : "plain"}
            options={chartOptions}
            series={candleSeries}
            type="candlestick"
            height={420}
          />
        )}
      </div>

      {!hasResult && !loading && !historyError && (
        <p className="cs-hint">
          Click <strong>Get Prediction</strong> to overlay tomorrow's forecast and confidence band on the chart.
        </p>
      )}

    </div>
  );
}
