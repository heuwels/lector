// TODO: Make this dynamic via model discovery
export const OLLAMA_MODELS = [
  { value: "llama3.2:3b", label: "Llama 3.2 3B (fastest, lower quality)" },
  { value: "llama3.1:8b", label: "Llama 3.1 8B (default, fast)" },
  { value: "gemma2:9b", label: "Gemma 2 9B (best quality, needs ~6GB RAM)" },
] as const;