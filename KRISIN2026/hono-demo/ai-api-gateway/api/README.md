# AI API Gateway (Demo)

Simple Cloudflare Worker gateway with:

- API key auth middleware
- Per-key rate limit middleware
- `/chat` upstream proxy with stream passthrough
- `/usage` usage query endpoint backed by KV

## Run

```txt
pnpm install
pnpm run dev
```

## Required headers

Send one of your configured keys:

```txt
x-api-key: demo-key-1
```

## Endpoints

- `POST /chat` - proxy request to `${UPSTREAM_BASE_URL}/chat/completions`
- `GET /usage?date=YYYY-MM-DD` - query current key usage
- `GET /usage/:apiKey?date=YYYY-MM-DD` - query a specific key usage
