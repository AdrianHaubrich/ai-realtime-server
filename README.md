# ai-realtime-server

Minimal Express backend for the OpenAI Realtime API. It mints ephemeral client secrets, manages per-session state and a sideband WS connection (via `call_id`) to capture transcript server-side, automatically registers a profile-extraction tool, and exposes extraction endpoints so the SwiftUI client stays keyless.

## Setup
- Node 18+ (`node -v` should be >= 18).
- Install deps: `cd ai-realtime-server && npm install`.
- Env: create `.env` (not committed). Minimum:
  ```
  OPENAI_API_KEY=sk-...
  PORT=3001
  EXTRACTION_COOLDOWN_SECONDS=1
  SIDEBAND_DEBUG_EVENTS=false
  ```
  Optional: `REALTIME_MODEL=gpt-realtime` (default) and voice/transcription flags are provided per request. `EXTRACTION_COOLDOWN_SECONDS` throttles automatic tool-driven extraction. `SIDEBAND_DEBUG_EVENTS=true` logs every sideband event type. Sideband uses the client secret plus `call_id` returned from the client’s WebRTC negotiation.

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
- `POST /session` – create a new Realtime session, stores state, returns `{ sessionId, clientSecret, expiresAt, callId? }`.
  - Body accepts `callId` if the client already negotiated WebRTC; backend will attach a sideband WS to the same session (using the client secret).
- `POST /session/call` – update a session with a `callId` (after WebRTC negotiation) and start/refresh the sideband WS.
- `POST /session/renew` – mint a new `clientSecret` for an existing session (keeps transcript/profile), returns `{ sessionId, clientSecret, expiresAt, instructions, callId }`. After renew, the frontend should post the new `callId` via `/session/call` once WebRTC renegotiation completes so sideband can reconnect.

### Extraction
- `POST /extract-profile` – run structured extraction over the server-captured transcript (sideband WS) and return `{ profile, instructions }`. The server also pushes updated `instructions` to the live Realtime session via sideband.
- Automatic extraction (tool-driven): the backend registers a `extract_profile` function tool on each sideband connection. When the model calls the tool, the server runs extraction, posts `function_call_output`, updates session `instructions`, and triggers a follow-up `response.create` so the assistant replies.

This uses `POST https://api.openai.com/v1/realtime/client_secrets` with a minimal session payload `{ "session": { "type": "realtime", ...optional model/audio... }}`. The frontend finalizes session config during WebRTC connect and surfaces `call_id`; the backend uses `call_id` + client secret to attach a sideband WS and capture transcript/instructions server-side.
