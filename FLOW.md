# Realtime Session Flow (with Sideband Transcript Capture)

This diagram shows the end-to-end setup: the frontend creates a session, negotiates WebRTC (getting `call_id`), the backend attaches a sideband WS using that `call_id` and client secret, and the server captures transcript for extraction/rehydration.

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant OpenAI as OpenAI Realtime
    participant Backend
    participant Sideband as Backend Sideband WS

    User->>Frontend: Open app / start session
    Frontend->>Backend: POST /session (model, voice, enableTranscription)
    Backend->>OpenAI: POST /realtime/client_secrets (ephemeral client secret)
    Backend->>Frontend: { sessionId, clientSecret, expiresAt, callId }

    Frontend->>OpenAI: POST /realtime/calls with SDP offer (Bearer clientSecret)
    OpenAI-->>Frontend: 201 SDP answer + Location header (call_id)
    Frontend->>OpenAI: WebRTC connect (data/audio)
    Frontend->>Backend: POST /session/call { sessionId, callId }

    Backend->>OpenAI: WS connect wss://api.openai.com/v1/realtime?call_id=... (Bearer clientSecret)
    OpenAI-->>Sideband: conversation events (user/assistant text)
    Sideband->>Backend: update session transcript (user/assistant)

    User->>Frontend: Chat (text/audio)
    OpenAI-->>Frontend: Assistant responses
    OpenAI-->>Sideband: Mirrored events (user/assistant)
    Sideband->>Backend: Keep transcript authoritative

    User->>Frontend: Trigger extraction
    Frontend->>Backend: POST /extract-profile { sessionId }
    Backend->>OpenAI: Responses API call to extract profile (using transcript)
    Backend-->>Frontend: { profile, instructions }
    Note over Frontend: Applies instructions to its Realtime session
```

Notes:
- The frontend handles the WebRTC SDP exchange and surfaces `call_id` to the backend.
- The backend sideband WS uses the client secret to join the same Realtime session and builds the canonical transcript (user + assistant).
- Extraction and rehydration use the backend transcript; the frontend applies returned instructions after renew.

## Renew Flow (Sideband + Instructions)

This diagram shows how renew rotates the client secret, returns updated instructions + call_id, and reconnects both the frontend and backend sideband to the new session.

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant OpenAI as OpenAI Realtime
    participant Backend
    participant Sideband as Backend Sideband WS

    User->>Frontend: Renew token (Retry)
    Frontend->>Backend: POST /session/renew { sessionId }
    Backend->>OpenAI: POST /realtime/client_secrets (new secret)
    Backend-->>Frontend: { clientSecret, expiresAt, instructions, callId }
    Frontend->>OpenAI: Reconnect with new secret + apply instructions
    Frontend->>Backend: POST /session/call { sessionId, callId } (new call_id after renegotiation)
    Backend->>OpenAI: WS reconnect wss://api.openai.com/v1/realtime?call_id=... (Bearer clientSecret)
    Sideband->>Backend: Resume transcript capture with latest callId/secret
    Note over Frontend: Applies returned instructions to its Realtime session
    Note over Backend: Sideband reconnects with refreshed call_id after renew
```

## Refresh Session (full reset)

This diagram shows a full refresh: the client requests a brand-new session, negotiates a new call_id, and reattaches the sideband; transcript starts over unless you carry it forward separately.

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant OpenAI as OpenAI Realtime
    participant Backend
    participant Sideband as Backend Sideband WS

    User->>Frontend: Refresh session
    Frontend->>Backend: POST /session (reset) (model/voice/transcription)
    Backend->>OpenAI: POST /realtime/client_secrets (new secret)
    Backend-->>Frontend: { sessionId, clientSecret, expiresAt, callId }
    Frontend->>OpenAI: POST /realtime/calls with SDP offer (Bearer clientSecret)
    OpenAI-->>Frontend: SDP answer + Location (call_id)
    Frontend->>OpenAI: WebRTC connect (data/audio)
    Frontend->>Backend: POST /session/call { sessionId, callId }
    Backend->>OpenAI: WS connect wss://api.openai.com/v1/realtime?call_id=... (Bearer clientSecret)
    Sideband->>Backend: Transcript capture starts fresh
    Note over Frontend,Backend: Prior transcript is not reused on full refresh
```
