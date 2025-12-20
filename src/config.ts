import dotenv from "dotenv";

dotenv.config();

export const apiKey = process.env.OPENAI_API_KEY;
export const defaultModel = process.env.REALTIME_MODEL || "gpt-realtime";
export const port = Number(process.env.PORT ?? 3001);
export const useRealtimeBetaHeader = false;
const extractionCooldownRaw = Number(process.env.EXTRACTION_COOLDOWN_SECONDS ?? 60);
export const extractionCooldownSeconds = Number.isFinite(extractionCooldownRaw)
  ? extractionCooldownRaw
  : 60;
export const sidebandDebugEvents =
  process.env.SIDEBAND_DEBUG_EVENTS?.toLowerCase() === "true";
