package routes

// Bonus: WebSocket live price ticker.
//
// Architecture:
//   Browser  ──WS──►  Go /ws/ticker  ◄──WS──  Binance stream.binance.com
//
// Go connects to Binance's free btcusdt@miniTicker stream, receives real-time
// trade data, and fans it out to all connected browser clients. If the Binance
// connection drops it automatically reconnects.

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ── Hub ───────────────────────────────────────────────────────────────────────

type hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]struct{}
}

var globalHub = &hub{
	clients: make(map[*websocket.Conn]struct{}),
}

func (h *hub) add(c *websocket.Conn) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *hub) remove(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

func (h *hub) broadcast(msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		c.WriteMessage(websocket.TextMessage, msg) //nolint:errcheck — disconnected clients cleaned up in WSHandler
	}
}

// ── Browser handler ───────────────────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// WSTickerHandler upgrades browser connections and keeps them alive to receive
// live price messages from the Binance feed.
func WSTickerHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade error: %v", err)
		return
	}

	globalHub.add(conn)
	defer func() {
		globalHub.remove(conn)
		conn.Close()
	}()

	// Block until the client disconnects (read loop handles ping/pong)
	conn.SetReadDeadline(time.Now().Add(24 * time.Hour))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

// ── Binance connection ────────────────────────────────────────────────────────

// binanceTicker is the relevant subset of the Binance 24hr mini-ticker event.
type binanceTicker struct {
	Close  string `json:"c"` // last price
	High   string `json:"h"` // 24h high
	Low    string `json:"l"` // 24h low
	Volume string `json:"v"` // 24h volume (BTC)
}

// TickerMessage is what the frontend receives.
type TickerMessage struct {
	Price  string `json:"price"`
	High24 string `json:"high24"`
	Low24  string `json:"low24"`
	Volume string `json:"volume"`
	Symbol string `json:"symbol"`
}

const binanceURL = "wss://stream.binance.com:9443/ws/btcusdt@miniTicker"

// StartBinanceTicker launches a background goroutine that connects to Binance
// and broadcasts price updates to all browser WebSocket clients.
func StartBinanceTicker() {
	go connectBinance()
}

func connectBinance() {
	for {
		log.Println("[ws] connecting to Binance ticker stream…")
		conn, _, err := websocket.DefaultDialer.Dial(binanceURL, nil)
		if err != nil {
			log.Printf("[ws] Binance dial error: %v — retrying in 5s", err)
			time.Sleep(5 * time.Second)
			continue
		}
		log.Println("[ws] Binance connected")
		readBinance(conn)
		conn.Close()
		log.Println("[ws] Binance disconnected — reconnecting in 2s")
		time.Sleep(2 * time.Second)
	}
}

func readBinance(conn *websocket.Conn) {
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var t binanceTicker
		if err := json.Unmarshal(raw, &t); err != nil {
			continue
		}

		out, err := json.Marshal(TickerMessage{
			Price:  t.Close,
			High24: t.High,
			Low24:  t.Low,
			Volume: t.Volume,
			Symbol: "BTCUSDT",
		})
		if err != nil {
			continue
		}

		globalHub.broadcast(out)
	}
}
