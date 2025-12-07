import express, { Request, Response as ExpressResponse } from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const apiKey = process.env.OPENAI_API_KEY;
const defaultModel = process.env.REALTIME_MODEL || "gpt-realtime";
const port = Number(process.env.PORT ?? 3001);

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

type TokenRequestBody = {
  model?: string;
  voice?: string;
  enableTranscription?: boolean;
};

app.get("/", (_req, res: ExpressResponse) => {
  res.json({ status: "ok", message: "Realtime ephemeral token service" });
});

app.post(
  "/token",
  async (req: Request<unknown, unknown, TokenRequestBody>, res: ExpressResponse) => {
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "Missing OPENAI_API_KEY in environment" });
    }

    const { model, voice, enableTranscription } = req.body ?? {};

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

    try {
      console.log(
        `[token] request model=${session.model ?? "<default>"} voice=${
          session.audio?.output?.voice ?? "<none>"
        } output_modalities=${session.output_modalities ?? "<default>"}`
      );

      const response = await fetch(
        "https://api.openai.com/v1/realtime/client_secrets",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ session }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[token] failed to mint client secret status=${response.status} body=${errorText}`
        );
        return res
          .status(response.status)
          .json({ error: "Failed to mint client secret", detail: errorText });
      }

      const data = await response.json();
      const clientSecret =
        data?.client_secret?.value ??
        data?.client_secret ??
        data?.value ??
        null;

      res.json({
        clientSecret,
        expiresAt: data?.expires_at ?? data?.client_secret?.expires_at,
        raw: data,
      });

      console.log(
        `[token] issued client_secret=${clientSecret ?? "<none>"} expires_at=${
          data?.expires_at ?? data?.client_secret?.expires_at ?? "<unknown>"
        } model=${session.model ?? "<default>"} voice=${
          session.audio?.output?.voice ?? "<none>"
        } output_modalities=${data?.session?.output_modalities ?? "<unknown>"}`
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : `Unexpected error: ${error}`;
      console.error("Token generation error:", error);
      res.status(500).json({ error: "Unexpected error", detail });
    }
  }
);

app.listen(port, () => {
  console.log(`Realtime token server listening on http://localhost:${port}`);
});
