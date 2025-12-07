import OpenAI from "openai";
import { apiKey } from "../config.js";

export const openai = new OpenAI({ apiKey });
