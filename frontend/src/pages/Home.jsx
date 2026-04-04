import { useState, useCallback, useMemo } from "react";
import Chart from "react-apexcharts";
import "./Home.css";

const PREDICT_URL = "http://localhost:8080/predict";

/** @param {unknown} v */
function parsePredictionNumber(v) {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function formatUsd(n) {
  const num =
    typeof n === "number" && Number.isFinite(n) ? n : parseFloat(String(n));
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [lowerBound, setLowerBound] = useState(null);
  const [upperBound, setUpperBound] = useState(null);

  const getPrediction = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(PREDICT_URL);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setError(data.error || "Request failed");
        setPrediction(null);
        setLowerBound(null);
        setUpperBound(null);
        return;
      }

      const pred = parsePredictionNumber(data.prediction);
      const lower = parsePredictionNumber(data.lower_bound);
      const upper = parsePredictionNumber(data.upper_bound);
      if (pred === null || lower === null || upper === null) {
        setError("Invalid prediction data");
        setPrediction(null);
        setLowerBound(null);
        setUpperBound(null);
        return;
      }

      setPrediction(pred);
      setLowerBound(lower);
      setUpperBound(upper);
    } catch {
      setError("Could not reach the server");
      setPrediction(null);
      setLowerBound(null);
      setUpperBound(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const hasResult =
    typeof prediction === "number" &&
    typeof lowerBound === "number" &&
    typeof upperBound === "number" &&
    Number.isFinite(prediction) &&
    Number.isFinite(lowerBound) &&
    Number.isFinite(upperBound);

  const chartSeries = useMemo(() => {
    if (!hasResult) return [];
    return [
      {
        name: "Confidence interval",
        type: "rangeArea",
        data: [{ x: "Forecast", y: [lowerBound, upperBound] }],
      },
      {
        name: "Prediction",
        type: "line",
        data: [{ x: "Forecast", y: prediction }],
      },
    ];
  }, [hasResult, lowerBound, upperBound, prediction]);

  const chartOptions = useMemo(
    () => ({
      chart: {
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily:
          "system-ui, 'Segoe UI', Roboto, sans-serif",
        animations: { enabled: true },
      },
      dataLabels: { enabled: false },
      stroke: {
        curve: "straight",
        width: [0, 3],
      },
      fill: {
        opacity: [0.35, 1],
        type: ["solid", "solid"],
      },
      colors: ["#a855f7", "#7c3aed"],
      xaxis: {
        type: "category",
        labels: { show: true },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          formatter: (val) => formatUsd(val),
        },
      },
      grid: {
        borderColor: "var(--border)",
        strokeDashArray: 4,
        padding: { left: 8, right: 12 },
      },
      legend: {
        position: "top",
        horizontalAlign: "left",
        fontWeight: 500,
        markers: { width: 10, height: 10, radius: 2 },
      },
      tooltip: {
        shared: true,
        intersect: false,
        y: {
          /**
           * Combo rangeArea + line: Apex sets isRangeData and passes range
           * start/end into the formatter. Line series has no range — val is
           * undefined — so read y from config for that series.
           */
          formatter(val, opts) {
            const { seriesIndex, dataPointIndex, w } = opts;
            const ser = w?.config?.series?.[seriesIndex];
            const lineMissingVal =
              val === undefined ||
              val === null ||
              (typeof val === "number" && Number.isNaN(val));
            if (ser?.type === "line" && lineMissingVal) {
              const y = ser.data?.[dataPointIndex]?.y;
              const n = parseFloat(String(y));
              return Number.isFinite(n) ? formatUsd(n) : "—";
            }
            if (Array.isArray(val)) {
              const lo = parseFloat(val[0]);
              const hi = parseFloat(val[1]);
              if (Number.isFinite(lo) && Number.isFinite(hi)) {
                return `${formatUsd(lo)} – ${formatUsd(hi)}`;
              }
            }
            return formatUsd(val);
          },
        },
      },
      markers: {
        size: [0, 5],
        strokeWidth: 2,
        strokeColors: "#fff",
        hover: { sizeOffset: 2 },
      },
    }),
    []
  );

  return (
    <section className="prediction-panel" aria-labelledby="prediction-heading">
      <h2 id="prediction-heading">BTC next-day forecast</h2>
      <button type="button" onClick={getPrediction} disabled={loading}>
        {loading ? "Loading…" : "Get Prediction"}
      </button>

      <div className="status" role="status" aria-live="polite">
        {loading && <p className="loading">Fetching prediction…</p>}
        {!loading && error && <p className="error">{error}</p>}
      </div>

      {!loading && hasResult && (
        <div className="prediction-chart">
          <Chart
            options={chartOptions}
            series={chartSeries}
            type="line"
            height={280}
          />
        </div>
      )}
    </section>
  );
}
