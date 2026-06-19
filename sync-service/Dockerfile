FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init sync-service 2>/dev/null || true
RUN go mod tidy 2>/dev/null || true
RUN go build -o sync-service -ldflags="-s -w" main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/sync-service .
ENV TZ=Asia/Kolkata
CMD ["./sync-service"]
