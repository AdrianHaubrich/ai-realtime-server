import { openai } from "./services/openaiClient.js";
import { UserProfile } from "./types.js";

export async function extractProfile(transcript: string): Promise<UserProfile> {
  try {
    const response = await openai.responses.create(<any>{
      model: "gpt-5.1",
      input: [
        {
          role: "system",
          content: `
You are extracting user profile data from a conversation transcript.

Rules:
- Output strictly matches the provided JSON schema.
- If unsure, use null.
- income is monthly and numeric.
          `.trim(),
        },
        {
          role: "user",
          content: transcript,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "user_profile",
          strict: true,
          schema: {
            type: "object",
            properties: {
              first_name: { type: ["string", "null"] },
              last_name: { type: ["string", "null"] },
              income: { type: ["number", "null"] },
            },
            required: ["first_name", "last_name", "income"],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: 128,
    });

    const outputText =
      (response as any)?.output?.[0]?.content?.[0]?.text ??
      (response as any)?.output_text;
    if (typeof outputText === "string" && outputText.trim().length > 0) {
      const parsed = JSON.parse(outputText) as Partial<UserProfile>;
      return {
        first_name:
          typeof parsed.first_name === "string" ? parsed.first_name : null,
        last_name:
          typeof parsed.last_name === "string" ? parsed.last_name : null,
        income:
          typeof parsed.income === "number" && Number.isFinite(parsed.income)
            ? parsed.income
            : null,
      };
    }
  } catch (error) {
    console.error("[extractProfile] openai extraction failed", error);
  }

  return { first_name: null, last_name: null, income: null };
}

export function buildInstructionsFromProfile(profile: UserProfile): string {
  return `
You are a helpful voice assistant.

The system maintains a JSON object called USER_PROFILE that reflects the latest extracted user data from the conversation.

USER_PROFILE:
${JSON.stringify(profile, null, 2)}

Guidelines:
- Treat USER_PROFILE as the source of truth for the user's personal details.
- Refer to the user by their first name when appropriate.
- Never read the JSON literally; speak naturally in full sentences.
- Always check USER_PROFILE before asking about missing or already-provided data.
- If any field is null (especially income, monthly), politely ask the user once to confirm or provide it.
- Do not repeatedly ask for the same missing field unless the user brings it up again.
`.trim();
}
