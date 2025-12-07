# ai-realtime-server

Minimal Express backend for the OpenAI Realtime API. It mints ephemeral client secrets, manages per-session state and WS connection, and exposes extraction endpoints so the SwiftUI client stays keyless.

## Setup
- Node 18+ (`node -v` should be >= 18).
- Install deps: `cd ai-realtime-server && npm install`.
- Env: create `.env` (not committed). Minimum:
  ```
  OPENAI_API_KEY=sk-...
  PORT=3001
  ```
  Optional: `REALTIME_MODEL=gpt-realtime` (default) and voice/transcription flags are provided per request.

## Run
- Local: `npm start` (builds then runs `dist/server.js`). For watch mode: `npm run dev`.
- Build only: `npm run build` (outputs to `dist/`).
- Docker: `docker build -t ai-realtime-server .` then `docker run --rm -p 3001:3001 --env-file .env ai-realtime-server`.
- Docker Compose (preferred): set `OPENAI_API_KEY=...` in `.env`, then `docker-compose up --build -d`; `docker-compose logs -f` to tail; `docker-compose down` to stop.

The server logs each HTTP request with method/path/status/duration by default.

## API
- `POST /token` – returns an ephemeral `client_secret` for the Realtime API.
  - Optional JSON body: `{ "model": "gpt-realtime", "voice": "marin" }` (both optional; frontend can configure session after connecting).
  - Response shape: `{ clientSecret, expiresAt, raw }`.

### Sessions
- `POST /session` – create a new Realtime session, stores state/WS, returns `{ sessionId, clientSecret, expiresAt }`.
- `POST /session/renew` – mint a new `clientSecret` for an existing session (keeps transcript/profile), returns `{ sessionId, clientSecret, expiresAt }`.

### Extraction
- `POST /extract-profile` – run structured extraction over the session transcript and push updated instructions into Realtime.

This uses the documented endpoint `POST https://api.openai.com/v1/realtime/client_secrets` with a minimal session payload `{ "session": { "type": "realtime", ...optional model/audio... }}`. The frontend can finalize session configuration when establishing the Realtime connection.
