import WebSocket from "ws";
import {
  extractionCooldownSeconds,
  sidebandDebugEvents,
  useRealtimeBetaHeader,
} from "../config.js";
import { buildInstructionsFromProfile, extractProfile } from "../extraction.js";
import { SessionState, TranscriptEntry } from "../types.js";
import { sessions } from "./sessionStore.js";

type SidebandRecord = { ws: WebSocket; heartbeat?: NodeJS.Timeout; retries: number };
const sidebandSockets = new Map<string, SidebandRecord>();
const MAX_RETRIES = 3;
const EXTRACT_TOOL_NAME = "extract_profile";

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
    sendToolConfiguration(state.sessionId, callId);
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

export function sendSessionInstructions(sessionId: string, instructions: string) {
  sendSessionUpdate(sessionId, { instructions }, {
    logPrefix: "instructions",
    logDetails: `instructions_length=${instructions.length}`,
  });
}

function handleSidebandEvent(event: any, sessionId: string) {
  const state = sessions.get(sessionId);
  if (!state) return;

  const type = event?.type;
  if (sidebandDebugEvents && typeof type === "string") {
    console.log(`[sideband] event type=${type} session=${sessionId}`);
  }
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
    case "conversation.item.created":
    case "conversation.item.added":
    case "conversation.item.done": {
      const item = event?.item;
      if (item?.type === "message") {
        const content = item?.content ?? [];
        const text =
          content?.[0]?.text ??
          content?.find?.((c: any) => c?.text)?.text ??
          "";
        if (sidebandDebugEvents && typeof item?.role === "string") {
          console.log(
            `[sideband] message item role=${item.role} session=${sessionId} text="${text}"`
          );
        }
        if (item?.role === "system") {
          console.log(
            `[sideband] system message received session=${sessionId} text="${text}"`
          );
        }
      }
      if (item?.type === "function_call") {
        registerFunctionCall(state, item);
      }
      break;
    }
    case "response.function_call_arguments.delta": {
      const callId = event?.call_id ?? event?.callId;
      const delta = event?.delta;
      if (typeof callId === "string" && typeof delta === "string") {
        ensureToolCallEntry(state, callId, event);
        appendFunctionCallArguments(state, callId, delta);
      }
      break;
    }
    case "response.function_call_arguments.done": {
      const callId = event?.call_id ?? event?.callId;
      const args = event?.arguments;
      if (typeof callId === "string" && typeof args === "string") {
        ensureToolCallEntry(state, callId, event);
        finalizeFunctionCallArguments(state, callId, args);
        void handleToolCall(state.sessionId, callId);
      }
      break;
    }
    case "session.updated": {
      console.log(`[sideband] session.updated received for session ${sessionId}`);
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

function sendToolConfiguration(sessionId: string, callId: string) {
  const state = sessions.get(sessionId);
  if (!state) return;
  if (state.toolConfigCallId === callId) {
    return;
  }

  const toolInstructions = [
    "The tool extract_profile parses the conversation and updates USER_PROFILE, which is synced to the UI profile card.",
    "Treat tool calls as the mechanism to enter or update profile fields for the user.",
    "When the user provides personal details (first name, last name, or monthly income),",
    "call extract_profile before responding and wait for the tool result.",
    "After the tool result, confirm the updated profile and guide the user to fill any missing fields.",
  ].join(" ");

  const toolConfig = {
    instructions: toolInstructions,
    tools: [
      {
        type: "function",
        name: EXTRACT_TOOL_NAME,
        description:
          "Extract the user's profile (first name, last name, monthly income) from the conversation transcript.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: "auto",
  };

  sendSessionUpdate(sessionId, toolConfig, {
    logPrefix: "tools",
    logDetails: `call_id=${callId} tools=${toolConfig.tools.length}`,
  });

  state.toolConfigCallId = callId;
  sessions.set(sessionId, state);
}

function registerFunctionCall(state: SessionState, item: any) {
  const callId = item?.call_id ?? item?.callId;
  const name = item?.name;
  const argumentsText = item?.arguments;
  if (typeof callId !== "string" || typeof name !== "string") {
    return;
  }

  const toolCalls = state.toolCalls ?? {};
  toolCalls[callId] = {
    name,
    arguments: typeof argumentsText === "string" ? argumentsText : toolCalls[callId]?.arguments,
    itemId: item?.id ?? toolCalls[callId]?.itemId,
    handled: toolCalls[callId]?.handled,
  };
  state.toolCalls = toolCalls;
  sessions.set(state.sessionId, state);
}

function ensureToolCallEntry(state: SessionState, callId: string, event: any) {
  const toolCalls = state.toolCalls ?? {};
  if (toolCalls[callId]) {
    return;
  }

  const name =
    event?.name ??
    event?.function_call?.name ??
    event?.item?.name ??
    EXTRACT_TOOL_NAME;
  const itemId = event?.item_id ?? event?.itemId ?? event?.item?.id;

  toolCalls[callId] = {
    name: typeof name === "string" ? name : EXTRACT_TOOL_NAME,
    itemId: typeof itemId === "string" ? itemId : undefined,
  };
  if (sidebandDebugEvents) {
    console.log(
      `[sideband] tool call inferred name=${toolCalls[callId].name} call_id=${callId}`
    );
  }
  state.toolCalls = toolCalls;
  sessions.set(state.sessionId, state);
}

function appendFunctionCallArguments(state: SessionState, callId: string, delta: string) {
  const toolCalls = state.toolCalls ?? {};
  const existing = toolCalls[callId];
  if (!existing) return;
  const current = existing.arguments ?? "";
  toolCalls[callId] = { ...existing, arguments: current + delta };
  state.toolCalls = toolCalls;
  sessions.set(state.sessionId, state);
}

function finalizeFunctionCallArguments(state: SessionState, callId: string, args: string) {
  const toolCalls = state.toolCalls ?? {};
  const existing = toolCalls[callId];
  if (!existing) return;
  toolCalls[callId] = { ...existing, arguments: args };
  state.toolCalls = toolCalls;
  sessions.set(state.sessionId, state);
}

async function handleToolCall(sessionId: string, callId: string) {
  const state = sessions.get(sessionId);
  if (!state) return;

  const toolCall = state.toolCalls?.[callId];
  if (!toolCall || toolCall.name !== EXTRACT_TOOL_NAME) {
    return;
  }
  if (toolCall.handled) {
    return;
  }

  const now = Date.now();
  toolCall.handled = true;
  if (state.toolCalls) {
    state.toolCalls[callId] = toolCall;
  }
  sessions.set(sessionId, state);
  if (state.isExtracting) {
    sendFunctionCallOutput(sessionId, callId, { ok: false, reason: "in_progress" });
    return;
  }
  if (state.lastExtractedAt && now - state.lastExtractedAt < extractionCooldownSeconds * 1000) {
    sendFunctionCallOutput(sessionId, callId, {
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: extractionCooldownSeconds,
    });
    return;
  }

  state.isExtracting = true;
  sessions.set(sessionId, state);

  try {
    const fullTranscript = state.transcript
      .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
      .join("\n")
      .trim();

    if (!fullTranscript) {
      sendFunctionCallOutput(sessionId, callId, { ok: false, reason: "no_transcript" });
      return;
    }

    const extracted = await extractProfile(fullTranscript);
    state.profile = extracted;
    state.lastExtractedAt = Date.now();
    sessions.set(sessionId, state);

    const instructions = buildInstructionsFromProfile(extracted);
    sendSessionInstructions(sessionId, instructions);
    sendFunctionCallOutput(sessionId, callId, { ok: true, profile: extracted });
    sendResponseCreate(sessionId);
  } catch (error) {
    console.error(`[sideband] tool extraction failed for session ${sessionId}`, error);
    sendFunctionCallOutput(sessionId, callId, { ok: false, reason: "error" });
    sendResponseCreate(sessionId);
  } finally {
    const latest = sessions.get(sessionId);
    if (latest) {
      latest.isExtracting = false;
      sessions.set(sessionId, latest);
    }
  }
}

function sendFunctionCallOutput(sessionId: string, callId: string, output: object) {
  const payload = {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      id: `${callId}-output`,
      call_id: callId,
      output: JSON.stringify(output),
    },
  };

  sendSidebandEvent(sessionId, payload, {
    logPrefix: "tool_output",
    logDetails: `call_id=${callId}`,
  });
}

function sendResponseCreate(sessionId: string) {
  const payload = {
    type: "response.create",
    response: {},
  };

  sendSidebandEvent(sessionId, payload, {
    logPrefix: "response.create",
    logDetails: "after_tool_output",
  });
}

function sendSessionUpdate(
  sessionId: string,
  sessionPatch: Record<string, unknown>,
  logMeta: { logPrefix: string; logDetails: string }
) {
  const payload = {
    type: "session.update",
    session: {
      type: "realtime",
      ...sessionPatch,
    },
  };

  sendSidebandEvent(sessionId, payload, {
    logPrefix: logMeta.logPrefix,
    logDetails: logMeta.logDetails,
  });
}

function sendSidebandEvent(
  sessionId: string,
  payload: Record<string, unknown>,
  logMeta: { logPrefix: string; logDetails: string }
) {
  const record = sidebandSockets.get(sessionId);
  const ws = record?.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn(`[sideband] cannot send ${logMeta.logPrefix}; socket not open for session ${sessionId}`);
    return;
  }

  console.log(
    `[sideband] ${payload.type} -> session=${sessionId} ${logMeta.logDetails}`
  );

  ws.send(JSON.stringify(payload), (err) => {
    if (err) {
      console.error(`[sideband] ${logMeta.logPrefix} failed for session ${sessionId}`, err);
    }
  });
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
