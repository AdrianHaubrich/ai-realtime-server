import dotenv from "dotenv";

dotenv.config();

export const apiKey = process.env.OPENAI_API_KEY;
export const defaultModel = process.env.REALTIME_MODEL || "gpt-realtime";
export const port = Number(process.env.PORT ?? 3001);
export const useRealtimeBetaHeader = false;
