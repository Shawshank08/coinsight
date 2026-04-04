import { useState, useCallback } from "react";
import "./Home.css";

const PREDICT_URL = "http://localhost:8080/predict";

function formatUsd(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
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

  return (
    <section className="prediction-panel" aria-labelledby="prediction-heading">
      <h2 id="prediction-heading">BTC next-day forecast</h2>
      <button
        type="button"
        onClick={getPrediction}
        disabled={loading}
      >
        {loading ? "Loading…" : "Get Prediction"}
      </button>

      <div className="status" role="status" aria-live="polite">
        {loading && <p className="loading">Fetching prediction…</p>}
        {!loading && error && <p className="error">{error}</p>}
      </div>

      {!loading && hasResult && (
        <dl className="results">
          <div className="prediction-value">
            <dt>Prediction</dt>
            <dd>{formatUsd(prediction)}</dd>
          </div>
          <div>
            <dt>Lower bound</dt>
            <dd>{formatUsd(lowerBound)}</dd>
          </div>
          <div>
            <dt>Upper bound</dt>
            <dd>{formatUsd(upperBound)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
