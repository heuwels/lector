export const SETTINGS_KEYS = {
  ANTHROPIC_API_KEY: "lector-api-key",
  ANKI_DECK_NAME: "lector-anki-deck",
  ANKI_CLOZE_DECK_NAME: "lector-anki-cloze-deck",
  DEFAULT_CARD_TYPE: "lector-card-type",
  TTS_SPEED: "lector-tts-speed",
  THEME: "lector-theme",
} as const;

// TODO: Make this dynamic via model discovery
export const OLLAMA_MODELS = [
  { value: "llama3.2:3b", label: "Llama 3.2 3B (fastest, lower quality)" },
  { value: "llama3.1:8b", label: "Llama 3.1 8B (default, fast)" },
  { value: "gemma2:9b", label: "Gemma 2 9B (best quality, needs ~6GB RAM)" },
] as const;