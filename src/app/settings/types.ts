import { type TTSMode } from "@/lib/tts";

export type CardType = "basic" | "cloze";
export type Theme = "light" | "dark" | "system";
export type LLMProvider = "ollama" | "anthropic" | "apfel" | "lmstudio";
export type LMStudioLoadStatus = "idle" | "loading" | "loaded" | "errored";

export interface LLMStatus {
  provider: string;
  model: string;
  ok: boolean;
  error?: string;
}

export interface AppSettings {
  apiKey: string;
  ankiDeckName: string;
  ankiClozeDeckName: string;
  defaultCardType: CardType;
  ttsSpeed: number;
  ttsMode: TTSMode;
  theme: Theme;
}