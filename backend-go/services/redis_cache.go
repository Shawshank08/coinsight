package services

// Bonus: Redis caching for predictions (5-minute TTL as specified in the PDF).
// If Redis is not available the service falls back to a simple in-memory map
// so predictions still work without Redis being installed.

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	rdb      *redis.Client
	rdbReady bool
	rdbOnce  sync.Once
)

const predictionTTL = 5 * time.Minute

// initRedis lazily connects to Redis using the REDIS_URL env var.
func initRedis() {
	rdbOnce.Do(func() {
		url := getEnv("REDIS_URL")
		if url == "" {
			url = "redis://localhost:6379"
		}

		opt, err := redis.ParseURL(url)
		if err != nil {
			log.Printf("[redis] invalid URL (%v); prediction caching disabled", err)
			return
		}

		client := redis.NewClient(opt)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		if err := client.Ping(ctx).Err(); err != nil {
			log.Printf("[redis] unreachable (%v); prediction caching disabled", err)
			return
		}

		rdb = client
		rdbReady = true
		log.Println("[redis] connected — prediction caching enabled (5 min TTL)")
	})
}

// ── In-memory fallback ────────────────────────────────────────────────────────

type memEntry struct {
	data      []byte
	expiresAt time.Time
}

var (
	memCache   = map[string]memEntry{}
	memCacheMu sync.RWMutex
)

// GetCachedPrediction looks up a cached prediction by key.
// It checks Redis first, then falls back to the in-memory map.
func GetCachedPrediction(key string) (json.RawMessage, bool) {
	initRedis()

	if rdbReady {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		val, err := rdb.Get(ctx, key).Bytes()
		if err == nil {
			return json.RawMessage(val), true
		}
	}

	// Fall back to in-memory
	memCacheMu.RLock()
	entry, ok := memCache[key]
	memCacheMu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return json.RawMessage(entry.data), true
	}
	return nil, false
}

// SetCachedPrediction stores a prediction in Redis (if available) and in-memory.
func SetCachedPrediction(key string, data []byte) {
	initRedis()

	if rdbReady {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		rdb.Set(ctx, key, data, predictionTTL)
	}

	memCacheMu.Lock()
	memCache[key] = memEntry{data: data, expiresAt: time.Now().Add(predictionTTL)}
	memCacheMu.Unlock()
}

// InvalidatePredictionCache clears all cached predictions (called after retrain).
func InvalidatePredictionCache() {
	initRedis()

	if rdbReady {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		// Delete all prediction keys
		for _, model := range []string{"xgboost", "prophet"} {
			rdb.Del(ctx, "prediction:"+model)
		}
	}

	memCacheMu.Lock()
	memCache = map[string]memEntry{}
	memCacheMu.Unlock()

	log.Println("[cache] prediction cache invalidated after retrain")
}
