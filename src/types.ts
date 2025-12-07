export type UserProfile = {
  first_name: string | null;
  last_name: string | null;
  income: number | null; // monthly
};

export type SessionState = {
  sessionId: string;
  clientSecret: string | null;
  expiresAt?: number | null;
  model: string;
  voice?: string | null;
  enableTranscription?: boolean;
  renewing?: boolean;
  profile: UserProfile;
  callId?: string | null;
  transcript: TranscriptEntry[];
};

export type OutputModality = "text" | string;

export type RealtimeSession = {
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

export type TokenRequestBody = {
  model?: string;
  voice?: string;
  enableTranscription?: boolean;
};

export type SessionRequestBody = TokenRequestBody & {
  previousSessionId?: string;
  callId?: string;
};

export type RenewRequestBody = { sessionId: string; transcript?: string };

export type ExtractProfileRequestBody = {
  sessionId: string;
  transcript?: string;
};

export type CloseSessionRequestBody = { sessionId: string };

export type TranscriptEntry = { role: "user" | "assistant"; text: string };
