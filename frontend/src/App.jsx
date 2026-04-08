import { useState, useEffect, useRef } from "react";
import Home from "./pages/Home.jsx";
import "./App.css";

const WS_URL = "ws://localhost:8080/ws/ticker";

function formatPrice(str) {
  const n = parseFloat(str);
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export default function App() {
  const [ticker, setTicker]   = useState(null);
  const [wsStatus, setWsStatus] = useState("connecting");
  const wsRef = useRef(null);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen    = () => setWsStatus("live");
      ws.onclose   = () => { setWsStatus("offline"); setTimeout(connect, 3000); };
      ws.onerror   = () => setWsStatus("offline");
      ws.onmessage = (e) => { try { setTicker(JSON.parse(e.data)); } catch {} };
    }
    connect();
    return () => wsRef.current?.close();
  }, []);

  return (
    <div id="app-shell">
      <header id="app-header">
        <div id="header-inner">
          {/* Brand */}
          <div id="brand">
            <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle cx="14" cy="14" r="14" fill="url(#cg)" />
              <path d="M14 7v2.5M14 18.5V21M10 10.5c0-1.1.9-2 2-2h4a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4"
                stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
              <defs>
                <linearGradient id="cg" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#a855f7" /><stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>
            <span id="brand-name">CoinSight</span>
          </div>

          {/* Live ticker */}
          <div id="live-ticker">
            <span className={`ws-dot ws-dot--${wsStatus}`} title={wsStatus} />
            {ticker ? (
              <>
                <span className="ticker-symbol">BTC/USDT</span>
                <span className="ticker-price">{formatPrice(ticker.price)}</span>
                <span className="ticker-meta">
                  H: {formatPrice(ticker.high24)} · L: {formatPrice(ticker.low24)}
                </span>
              </>
            ) : (
              <span className="ticker-meta">
                {wsStatus === "connecting" ? "Connecting to live feed…" : "Live feed offline"}
              </span>
            )}
          </div>
        </div>
      </header>

      <main id="app-main">
        <Home />
      </main>

      <footer id="app-footer">
        Powered by XGBoost · Historical data via CoinGecko · Live prices via Binance
      </footer>
    </div>
  );
}
