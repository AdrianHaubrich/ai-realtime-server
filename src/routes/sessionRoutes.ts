import crypto from "crypto";
import { Router, Request, Response as ExpressResponse } from "express";
import { defaultModel } from "../config.js";
import { sessions } from "../services/sessionStore.js";
import { mintToken } from "../services/tokenService.js";
import { buildInstructionsFromProfile } from "../extraction.js";
import { startSidebandConnection } from "../services/sideband.js";
import { closeSidebandConnection } from "../services/sideband.js";
import {
  CloseSessionRequestBody,
  RenewRequestBody,
  SessionRequestBody,
  TokenRequestBody,
  UserProfile,
} from "../types.js";

const router = Router();

router.post(
  "/token",
  async (req: Request<unknown, unknown, TokenRequestBody>, res: ExpressResponse) => {
    try {
      const data = await mintToken(req.body ?? {});
      res.json(data);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : `Unexpected error: ${error}`;
      res.status(500).json({ error: "Failed to mint client secret", detail });
    }
  }
);

router.post(
  "/session",
  async (req: Request<unknown, unknown, SessionRequestBody>, res: ExpressResponse) => {
    try {
      const sessionRequest = req.body ?? {};
      const previousSessionId = sessionRequest.previousSessionId;
      const callId = sessionRequest.callId;

      if (previousSessionId) {
        const previous = sessions.get(previousSessionId);
        if (previous) {
          sessions.delete(previousSessionId);
        }
      }

      const selectedModel = sessionRequest.model || defaultModel;
      const tokenResult = await mintToken(sessionRequest);
      const sessionId = crypto.randomUUID();

      const state = {
        sessionId,
        clientSecret: tokenResult.clientSecret,
        expiresAt: tokenResult.expiresAt,
        model: selectedModel,
        voice: sessionRequest.voice,
        enableTranscription: sessionRequest.enableTranscription,
        renewing: false,
        profile: { first_name: null, last_name: null, income: null } as UserProfile,
        callId: callId ?? null,
        transcript: [],
        toolConfigCallId: null,
        toolCalls: {},
        isExtracting: false,
        lastExtractedAt: undefined,
      };
      sessions.set(sessionId, state);

      // If a callId is provided, start sideband connection on the backend.
      if (callId) {
        startSidebandConnection(callId, state);
      }

      res.json({
        sessionId,
        clientSecret: tokenResult.clientSecret,
        expiresAt: tokenResult.expiresAt,
        callId,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : `Unexpected error: ${error}`;
      res.status(500).json({ error: "Failed to create session", detail });
    }
  }
);

router.post(
  "/session/renew",
  async (req: Request<unknown, unknown, RenewRequestBody>, res: ExpressResponse) => {
    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const state = sessions.get(sessionId);
    if (!state) {
      return res.status(404).json({ error: "Unknown sessionId" });
    }

    if (state.renewing) {
      return res.status(429).json({ error: "Renew already in progress" });
    }

    state.renewing = true;

    try {
      const tokenResult = await mintToken({
        model: state.model,
        voice: state.voice ?? undefined,
        enableTranscription: state.enableTranscription,
      });

      state.clientSecret = tokenResult.clientSecret;
      state.expiresAt = tokenResult.expiresAt;

      sessions.set(sessionId, state);

      // Rehydrate instructions using client-provided transcript (authoritative from frontend).
      try {
        const profileInstructions = buildInstructionsFromProfile(state.profile);
        const transcriptContext = state.transcript
          .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
          .join("\n");
        const instructions =
          transcriptContext.trim().length > 0
            ? `${profileInstructions}\n\nConversation history:\n${transcriptContext}`
            : profileInstructions;
        console.log(
          `[renew] using server transcript for session ${sessionId} transcript_lines=${state.transcript.length}`
        );
        // Frontend owns pushing these instructions to its Realtime session; backend keeps profile only.
      } catch (err) {
        console.error("[renew] failed to build rehydration instructions", err);
      }

      const profileInstructions = buildInstructionsFromProfile(state.profile);
      const transcriptContext = state.transcript
        .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
        .join("\n");
      const instructions =
        transcriptContext.length > 0
          ? `${profileInstructions}\n\nConversation history:\n${transcriptContext}`
          : profileInstructions;

      res.json({
        sessionId,
        clientSecret: tokenResult.clientSecret,
        expiresAt: tokenResult.expiresAt,
        instructions,
        callId: state.callId,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : `Unexpected error: ${error}`;
      res.status(500).json({ error: "Failed to renew session token", detail });
    } finally {
      state.renewing = false;
    }
  }
);

router.post(
  "/session/close",
  async (req: Request<unknown, unknown, CloseSessionRequestBody>, res: ExpressResponse) => {
    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const state = sessions.get(sessionId);
    if (state) {
      closeSidebandConnection(sessionId);
      sessions.delete(sessionId);
    }

    res.json({ sessionId, closed: !!state });
  }
);

router.post(
  "/session/call",
  async (
    req: Request<unknown, unknown, { sessionId: string; callId: string }>,
    res: ExpressResponse
  ) => {
    const { sessionId, callId } = req.body ?? {};
    if (!sessionId || !callId) {
      return res.status(400).json({ error: "sessionId and callId are required" });
    }

    const state = sessions.get(sessionId);
    if (!state) {
      return res.status(404).json({ error: "Unknown sessionId" });
    }

    if (state.callId && state.callId !== callId) {
      closeSidebandConnection(sessionId);
    }

    state.callId = callId;
    sessions.set(sessionId, state);
    startSidebandConnection(callId, state);

    res.json({ sessionId, callId });
  }
);

export default router;
