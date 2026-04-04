import { useState, useCallback, useMemo } from "react";
import Chart from "react-apexcharts";
import "./Home.css";

const PREDICT_URL = "http://localhost:8080/predict";

function formatUsd(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
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

      setPrediction(data.prediction);
      setLowerBound(data.lower_bound);
      setUpperBound(data.upper_bound);
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
    prediction != null && lowerBound != null && upperBound != null;

  const chartSeries = useMemo(() => {
    if (!hasResult) return [];
    // Two x points so the range area reads as a clear horizontal band.
    const x1 = "Forecast";
    const x2 = " ";
    return [
      {
        name: "Confidence interval",
        type: "rangeArea",
        data: [
          { x: x1, y: [lowerBound, upperBound] },
          { x: x2, y: [lowerBound, upperBound] },
        ],
      },
      {
        name: "Prediction",
        type: "line",
        data: [
          { x: x1, y: prediction },
          { x: x2, y: prediction },
        ],
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
        labels: {
          show: true,
          formatter(val) {
            return val?.trim() ? val : "";
          },
        },
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
          formatter(val) {
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

      {!loading && hasResult && chartSeries.length > 0 && (
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
