import WebSocket from "ws";
import { useRealtimeBetaHeader } from "../config.js";
import { SessionState, TranscriptEntry } from "../types.js";
import { sessions } from "./sessionStore.js";

type SidebandRecord = { ws: WebSocket; heartbeat?: NodeJS.Timeout; retries: number };
const sidebandSockets = new Map<string, SidebandRecord>();
const MAX_RETRIES = 3;

export function startSidebandConnection(callId: string, state: SessionState) {
  const existingRecord = sidebandSockets.get(state.sessionId);
  const existing = existingRecord?.ws;
  if (existing && existing.readyState === WebSocket.OPEN) {
    console.log(`[sideband] already connected for session ${state.sessionId}`);
    return;
  }

  if (!state.clientSecret) {
    console.warn(`[sideband] missing clientSecret for session ${state.sessionId}; cannot connect`);
    return;
  }

  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
    headers: {
      Authorization: `Bearer ${state.clientSecret}`,
      ...(useRealtimeBetaHeader ? { "OpenAI-Beta": "realtime=v1" } : {}),
    },
  });

  ws.on("open", () => {
    console.log(`[sideband] connected for session ${state.sessionId} call_id=${callId}`);
    startHeartbeat(state.sessionId);
    const record = sidebandSockets.get(state.sessionId);
    if (record) {
      record.retries = 0;
      sidebandSockets.set(state.sessionId, record);
    }
  });

  ws.on("message", (data: WebSocket.RawData) => {
    try {
      const text = data.toString();
      const event = JSON.parse(text);
      handleSidebandEvent(event, state.sessionId);
    } catch (err) {
      console.error("[sideband] failed to parse event", err);
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    console.warn(
      `[sideband] closed for session ${state.sessionId} code=${code} reason=${reason.toString()}`
    );
    stopHeartbeat(state.sessionId);
    sidebandSockets.delete(state.sessionId);
    // Attempt a single reconnect with the latest session state.
    const latest = sessions.get(state.sessionId);
    if (latest?.callId && latest?.clientSecret) {
      const currentRetry = (existingRecord?.retries ?? 0) + 1;
      if (currentRetry <= MAX_RETRIES) {
        console.log(
          `[sideband] attempting reconnect (${currentRetry}/${MAX_RETRIES}) for session ${state.sessionId}`
        );
        sidebandSockets.set(state.sessionId, { ws, retries: currentRetry });
        startSidebandConnection(latest.callId, latest);
      } else {
        console.warn(`[sideband] max retries reached for session ${state.sessionId}; giving up`);
      }
    }
  });

  ws.on("error", (err: Error) => {
    console.error(`[sideband] error for session ${state.sessionId}`, err);
  });

  sidebandSockets.set(state.sessionId, { ws, retries: existingRecord?.retries ?? 0 });
}

function handleSidebandEvent(event: any, sessionId: string) {
  const state = sessions.get(sessionId);
  if (!state) return;

  const type = event?.type;
  if (!type) return;

  switch (type) {
    case "conversation.item.input_text.completed": {
      const text =
        event?.item?.content?.[0]?.text ??
        event?.item?.content?.find?.((c: any) => c?.type === "input_text")?.text;
      if (typeof text === "string" && text.trim().length > 0) {
        addTranscriptEntry(state, { role: "user", text });
      }
      break;
    }
    case "conversation.item.input_audio_transcription.completed": {
      const transcript =
        event?.transcript ??
        event?.item?.content?.find?.((c: any) => c?.type === "input_audio_transcription")
          ?.transcript;
      if (typeof transcript === "string" && transcript.trim().length > 0) {
        addTranscriptEntry(state, { role: "user", text: transcript });
      }
      break;
    }
    case "conversation.item.output_text.completed": {
      const text =
        event?.item?.content?.[0]?.text ??
        event?.item?.content?.find?.((c: any) => c?.type === "output_text")?.text;
      if (typeof text === "string" && text.trim().length > 0) {
        addTranscriptEntry(state, { role: "assistant", text });
      }
      break;
    }
    case "conversation.item.added":
    case "conversation.item.done": {
      const role = event?.item?.role as TranscriptEntry["role"] | undefined;
      // Only use item add/done for user items that did not emit a completed event (fallback).
      if (role === "user") {
        const content = event?.item?.content;
        const text =
          content?.[0]?.text ??
          content?.find?.((c: any) => c?.text)?.text ??
          content?.find?.((c: any) => c?.transcript)?.transcript;
        if (typeof text === "string" && text.trim().length > 0) {
          addTranscriptEntry(state, { role: "user", text });
        }
      }
      break;
    }
    case "response.output_text.done": {
      const text = event?.output_text;
      if (typeof text === "string" && text.trim().length > 0) {
        addTranscriptEntry(state, { role: "assistant", text });
      }
      break;
    }
    case "response.output_text.delta": {
      // Ignore deltas; rely on done events for final text.
      break;
    }
    case "response.output_audio_transcript.delta": {
      // Ignore deltas; rely on done events for final transcript.
      break;
    }
    case "response.output_audio_transcript.done": {
      const transcript = event?.transcript ?? event?.output_audio_transcript;
      if (typeof transcript === "string" && transcript.trim().length > 0) {
        addTranscriptEntry(state, { role: "assistant", text: transcript });
      }
      break;
    }
    default: {
      // ignore non-transcript events
    }
  }
}

function addTranscriptEntry(state: SessionState, entry: TranscriptEntry) {
  const current = sessions.get(state.sessionId) ?? state;
  const trimmed = entry.text.trim();
  const last = current.transcript[current.transcript.length - 1];
  if (last && last.role === entry.role && last.text === trimmed) {
    return; // avoid duplicate consecutive entries
  }
  current.transcript.push({ ...entry, text: trimmed });
  sessions.set(current.sessionId, current);
  console.log(
    `[sideband] transcript +1 ${entry.role} session=${current.sessionId} total=${current.transcript.length} text="${trimmed}"`
  );
}

export function closeSidebandConnection(sessionId: string) {
  const record = sidebandSockets.get(sessionId);
  if (record?.ws && record.ws.readyState === WebSocket.OPEN) {
    record.ws.close(1000, "session_closed");
  }
  stopHeartbeat(sessionId);
  sidebandSockets.delete(sessionId);
}

function startHeartbeat(sessionId: string) {
  const record = sidebandSockets.get(sessionId);
  if (!record) return;
  const ws = record.ws;
  if (ws.readyState !== WebSocket.OPEN) return;

  const interval = setInterval(() => {
    const current = sidebandSockets.get(sessionId)?.ws;
    if (!current || current.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      return;
    }
    try {
      current.ping();
    } catch (err) {
      clearInterval(interval);
    }
  }, 30000);

  record.heartbeat = interval;
  sidebandSockets.set(sessionId, record);
}

function stopHeartbeat(sessionId: string) {
  const record = sidebandSockets.get(sessionId);
  if (record?.heartbeat) {
    clearInterval(record.heartbeat);
    record.heartbeat = undefined;
  }
}
