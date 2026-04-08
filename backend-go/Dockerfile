FROM golang:1.21-alpine AS builder

WORKDIR /app

# Download dependencies first (cached unless go.mod changes)
COPY go.mod go.sum* ./
RUN go mod download

# Copy source and build
COPY . .
RUN go build -o coinsight-backend .

# ── Runtime image ──────────────────────────────────────────────
FROM alpine:3.19

WORKDIR /app
COPY --from=builder /app/coinsight-backend .

EXPOSE 8080

CMD ["./coinsight-backend"]