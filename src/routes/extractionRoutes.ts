import { Router, Request, Response as ExpressResponse } from "express";
import { extractProfile, buildInstructionsFromProfile } from "../extraction.js";
import { sessions } from "../services/sessionStore.js";
import { ExtractProfileRequestBody } from "../types.js";

const router = Router();

router.post(
  "/extract-profile",
  async (
    req: Request<unknown, unknown, ExtractProfileRequestBody>,
    res: ExpressResponse
  ) => {
    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const state = sessions.get(sessionId);
    if (!state) {
      return res.status(404).json({ error: "Unknown sessionId" });
    }

    const fullTranscript = state.transcript
      .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
      .join("\n")
      .trim();
    if (!fullTranscript) {
      return res
        .status(400)
        .json({ error: "No transcript available for extraction" });
    }

    const extracted = await extractProfile(fullTranscript);
    state.profile = extracted;

    const instructions = buildInstructionsFromProfile(extracted);

    console.log("[extract-profile] updated profile", extracted);

    sessions.set(sessionId, state);

    res.json({
      profile: extracted,
      instructions,
    });
  }
);

export default router;
