import { apiKey, defaultModel, useRealtimeBetaHeader } from "../config.js";
import { TokenRequestBody } from "../types.js";

type OutputModality = "text" | string;

type RealtimeSession = {
  type: "realtime";
  model?: string;
  audio?: {
    output?: { voice?: string };
    input?: {
      transcription?: { model: string };
    };
  };
  output_modalities?: OutputModality[];
};

export async function mintToken(body: TokenRequestBody) {
  const { model, voice, enableTranscription } = body;

  const session: RealtimeSession = {
    type: "realtime",
    model: model || defaultModel,
  };

  if (voice) {
    session.audio = { ...(session.audio ?? {}), output: { voice } };
  } else {
    session.output_modalities = ["text"];
  }

  if (enableTranscription) {
    session.audio = session.audio ?? {};
    session.audio.input = {
      ...(session.audio.input ?? {}),
      transcription: { model: "gpt-4o-mini-transcribe" },
    };
  }

  console.log(
    `[token] request model=${session.model ?? "<default>"} voice=${
      session.audio?.output?.voice ?? "<none>"
    } output_modalities=${session.output_modalities ?? "<default>"}`
  );

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }

  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(useRealtimeBetaHeader ? { "OpenAI-Beta": "realtime=v1" } : {}),
      },
      body: JSON.stringify({ session }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[token] failed to mint client secret status=${response.status} body=${errorText}`
    );
    throw new Error(errorText);
  }

  const data = await response.json();
  const clientSecret =
    data?.client_secret?.value ?? data?.client_secret ?? data?.value ?? null;

  console.log(
    `[token] issued client_secret=${clientSecret ?? "<none>"} expires_at=${
      data?.expires_at ?? data?.client_secret?.expires_at ?? "<unknown>"
    } model=${session.model ?? "<default>"} voice=${
      session.audio?.output?.voice ?? "<none>"
    } output_modalities=${data?.session?.output_modalities ?? "<unknown>"}`
  );

  return {
    clientSecret,
    expiresAt: data?.expires_at ?? data?.client_secret?.expires_at,
    raw: data,
  };
}
