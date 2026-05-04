// Text-to-Speech wrapper for Afrikaans
// Uses Google Cloud TTS when available, falls back to browser TTS

// Default speech rate (1.0 is normal speed)
const DEFAULT_RATE = 0.9;

// Afrikaans language code
const AFRIKAANS_LANG = "af-ZA";

// Fallback languages if Afrikaans is not available
const FALLBACK_LANGS = ["af", "nl-NL", "nl"]; // Dutch is somewhat similar

// Preferred voice name patterns (higher quality voices)
const PREFERRED_VOICE_PATTERNS = [
  /google/i,
  /premium/i,
  /enhanced/i,
  /natural/i,
  /neural/i,
];

// Voice names to avoid (often robotic sounding)
const AVOID_VOICE_PATTERNS = [
  /espeak/i,
  /mbrola/i,
];

// Cached voice selection for browser TTS
let cachedVoice: SpeechSynthesisVoice | undefined;
let voiceInitialized = false;

// Audio element for Google TTS playback
let audioElement: HTMLAudioElement | null = null;

// LocalStorage keys
const VOICE_PREF_KEY = 'lector-tts-voice';
const TTS_MODE_KEY = 'lector-tts-mode';

// TTS modes
export type TTSMode = 'google' | 'browser';

/**
 * Check if the browser supports the Web Speech API
 * @returns true if browser TTS is available
 */
export function isTTSAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Get the current TTS mode preference
 */
export function getTTSMode(): TTSMode {
  if (typeof window === "undefined") return 'browser';
  return (localStorage.getItem(TTS_MODE_KEY) as TTSMode) || 'google';
}

/**
 * Set the TTS mode preference
 */
export function setTTSMode(mode: TTSMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TTS_MODE_KEY, mode);
}

/**
 * Score a voice based on quality indicators
 * Higher score = better quality
 */
function scoreVoice(voice: SpeechSynthesisVoice): number {
  let score = 0;

  // Prefer local/offline voices (usually higher quality)
  if (voice.localService) score += 5;

  // Prefer voices with preferred name patterns
  for (const pattern of PREFERRED_VOICE_PATTERNS) {
    if (pattern.test(voice.name)) {
      score += 10;
      break;
    }
  }

  // Avoid certain voice types
  for (const pattern of AVOID_VOICE_PATTERNS) {
    if (pattern.test(voice.name)) {
      score -= 20;
      break;
    }
  }

  // Prefer exact language match
  if (voice.lang === AFRIKAANS_LANG) score += 3;
  if (voice.lang.startsWith("af")) score += 2;

  return score;
}

/**
 * Get the best available voice for Afrikaans (browser TTS)
 * Caches the result for consistent voice selection
 * @returns The voice to use, or undefined if none found
 */
function getAfrikaansVoice(): SpeechSynthesisVoice | undefined {
  if (!isTTSAvailable()) {
    return undefined;
  }

  // Return cached voice if already selected
  if (voiceInitialized && cachedVoice) {
    return cachedVoice;
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    return undefined;
  }

  // Check for user's saved preference
  const savedVoiceName = localStorage.getItem(VOICE_PREF_KEY);
  if (savedVoiceName) {
    const savedVoice = voices.find(v => v.name === savedVoiceName);
    if (savedVoice) {
      cachedVoice = savedVoice;
      voiceInitialized = true;
      return cachedVoice;
    }
  }

  // Find all candidate voices (Afrikaans or Dutch)
  const allLangs = [AFRIKAANS_LANG, "af", ...FALLBACK_LANGS];
  const candidateVoices = voices.filter(v =>
    allLangs.some(lang => v.lang === lang || v.lang.startsWith(lang.split("-")[0]))
  );

  if (candidateVoices.length === 0) {
    voiceInitialized = true;
    return undefined;
  }

  // Sort by score and pick the best one
  candidateVoices.sort((a, b) => scoreVoice(b) - scoreVoice(a));
  cachedVoice = candidateVoices[0];
  voiceInitialized = true;

  // Save the selection for next time
  if (cachedVoice) {
    localStorage.setItem(VOICE_PREF_KEY, cachedVoice.name);
  }

  return cachedVoice;
}

/**
 * Set a specific voice by name (browser TTS)
 * @param voiceName - The name of the voice to use
 */
export function setPreferredVoice(voiceName: string): void {
  if (!isTTSAvailable()) return;

  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.name === voiceName);

  if (voice) {
    cachedVoice = voice;
    voiceInitialized = true;
    localStorage.setItem(VOICE_PREF_KEY, voiceName);
  }
}

/**
 * Get the currently selected voice name
 */
export function getCurrentVoiceName(): string | undefined {
  return cachedVoice?.name || localStorage.getItem(VOICE_PREF_KEY) || undefined;
}

/**
 * Speak using Google Cloud TTS
 * @returns true if successful, false if should fall back to browser TTS
 */
async function speakWithGoogle(text: string, rate: number): Promise<boolean> {
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, rate, language: (await import('./data-layer')).getActiveLanguage() }),
    });

    const data = await response.json();

    // Check if we should fall back to browser TTS
    if (data.fallback || data.error) {
      console.log('Google TTS unavailable, using browser TTS:', data.error);
      return false;
    }

    // Stop any current audio
    stopSpeaking();

    // Create audio element and play
    const audioData = `data:${data.contentType};base64,${data.audioContent}`;
    audioElement = new Audio(audioData);
    audioElement.play();

    return true;
  } catch (error) {
    console.error('Google TTS error:', error);
    return false;
  }
}

/**
 * Speak using browser's speech synthesis
 */
function speakWithBrowser(text: string, rate: number): void {
  if (!isTTSAvailable()) {
    console.warn("Text-to-speech is not available in this browser");
    return;
  }

  // Stop any current speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  // Set the voice (try Afrikaans, fall back to Dutch)
  const voice = getAfrikaansVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    // Set language even without a specific voice
    utterance.lang = AFRIKAANS_LANG;
  }

  // Set speech parameters
  utterance.rate = Math.max(0.1, Math.min(10, rate));
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Speak
  window.speechSynthesis.speak(utterance);
}

/**
 * Speak text in Afrikaans
 * Uses Google Cloud TTS if available, falls back to browser TTS
 * @param text - The text to speak
 * @param rate - Speech rate (default 0.9 for clearer learning)
 */
export async function speak(text: string, rate: number = DEFAULT_RATE): Promise<void> {
  const mode = getTTSMode();

  if (mode === 'google') {
    // Try Google TTS first
    const success = await speakWithGoogle(text, rate);
    if (success) return;
  }

  // Fall back to browser TTS
  speakWithBrowser(text, rate);
}

/**
 * Stop any current speech (both Google and browser)
 */
export function stopSpeaking(): void {
  // Stop browser TTS
  if (isTTSAvailable()) {
    window.speechSynthesis.cancel();
  }

  // Stop audio element
  if (audioElement) {
    audioElement.pause();
    audioElement.currentTime = 0;
    audioElement = null;
  }
}

/**
 * Get available voices for Afrikaans or Dutch (browser TTS)
 * Useful for debugging or letting users choose a voice
 * @returns Array of available voices
 */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!isTTSAvailable()) {
    return [];
  }

  const voices = window.speechSynthesis.getVoices();
  const relevantLangs = [AFRIKAANS_LANG, ...FALLBACK_LANGS];

  return voices.filter((v) =>
    relevantLangs.some(
      (lang) => v.lang === lang || v.lang.startsWith(lang.split("-")[0])
    )
  );
}

/**
 * Wait for voices to be loaded and initialize the cache
 * Some browsers load voices asynchronously
 * @returns Promise that resolves when voices are available
 */
export function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isTTSAvailable()) {
      resolve([]);
      return;
    }

    const initializeAndResolve = () => {
      const voices = window.speechSynthesis.getVoices();
      // Pre-initialize the voice cache
      if (voices.length > 0 && !voiceInitialized) {
        getAfrikaansVoice();
      }
      resolve(voices);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      initializeAndResolve();
      return;
    }

    // Wait for voiceschanged event
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      initializeAndResolve,
      { once: true }
    );

    // Timeout after 3 seconds
    setTimeout(initializeAndResolve, 3000);
  });
}

/**
 * Reset voice cache (useful if user wants to re-select)
 */
export function resetVoiceCache(): void {
  cachedVoice = undefined;
  voiceInitialized = false;
  localStorage.removeItem(VOICE_PREF_KEY);
}

/**
 * Check if Google Cloud TTS is configured
 * Makes a test request to see if the API key is set
 */
export async function isGoogleTTSConfigured(): Promise<boolean> {
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'test' }),
    });
    const data = await response.json();
    return !data.fallback;
  } catch {
    return false;
  }
}
