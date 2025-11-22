# Realtime Token Server

Minimal Express server that mints ephemeral client secrets for the OpenAI Realtime API. Designed to keep your root API key on the server while letting the SwiftUI client use temporary keys for WebRTC chat.

## Setup
- Install Node 18+: `node -v` should be >= 18.
- From the repo root: `cd realtime-server && npm install`.
- Create `.env` (not committed) and set at least `OPENAI_API_KEY=...`. Example:
  ```
  OPENAI_API_KEY=sk-...
  PORT=3001
  ```

## Run
- `npm start` (or `npm run dev` for watch mode). Defaults to `http://localhost:3001`.
- Docker: `docker build -t realtime-server .` then `docker run --rm -p 3001:3001 --env-file .env realtime-server`.
- Docker Compose (preferred): set `OPENAI_API_KEY=...` in `.env`, then `docker-compose up --build -d` to start; `docker-compose logs -f` to tail; `docker-compose down` to stop.

## API
- `POST /token` – returns an ephemeral `client_secret` for the Realtime API.
  - Optional JSON body: `{ "model": "gpt-realtime", "voice": "marin" }` (both optional; frontend can configure session after connecting).
  - Response shape: `{ clientSecret, expiresAt, raw }`.

This uses the documented endpoint `POST https://api.openai.com/v1/realtime/client_secrets` with a minimal session payload `{ "session": { "type": "realtime", ...optional model/audio... }}`. The frontend can finalize session configuration when establishing the Realtime connection.
