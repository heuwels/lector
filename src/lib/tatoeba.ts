// Tatoeba API client for fetching Afrikaans sentences with translations

import { lookupWord } from './dictionary';
import { ClozeCollection } from './db';

// Use local API route to avoid CORS issues
const API_URL = "/api/tatoeba";

// Common words to avoid using as cloze targets
const AVOID_WORDS = new Set([
  "'n", "die", "en", "of", "in", "op", "vir", "met", "na", "van",
  "is", "het", "om", "te", "dat", "wat", "as", "aan", "by", "sy", "hy",
  "nie", "ek", "jy", "ons", "hulle", "dit", "was", "sal", "kan", "moet",
  "maar", "ook", "al", "nog", "so", "toe", "nou", "net", "eers", "dan",
]);

// Types
export interface TatoebaSentence {
  id: number;
  text: string;
  lang: string;
  translation?: {
    id: number;
    text: string;
    lang: string;
  };
}

/**
 * Fetch random Afrikaans sentences with English translations
 * @param limit - Maximum number of sentences to fetch (default: 10, max: 100)
 * @returns Array of sentences with translations
 */
export async function fetchAfrikaansSentences(
  limit: number = 10
): Promise<TatoebaSentence[]> {
  try {
    const response = await fetch(
      `${API_URL}?limit=${Math.min(limit, 100)}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    const data = await response.json();
    return data.sentences || [];
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        "Could not connect to server. Check your internet connection."
      );
    }
    throw error;
  }
}

/**
 * Find the best word to use as cloze target based on frequency
 * Returns the rarest word that's in our dictionary, or a random content word
 */
export function findBestClozeWord(sentence: string): { word: string; index: number; rank: number | undefined } {
  const words = sentence.split(/\s+/);

  let bestWord = { word: words[0], index: 0, rank: undefined as number | undefined };
  let bestRank = Infinity;

  for (let i = 0; i < words.length; i++) {
    // Clean the word (remove punctuation)
    const cleanWord = words[i].replace(/[.,!?;:'"()[\]{}]/g, '').toLowerCase();

    // Skip short words and common words
    if (cleanWord.length < 3 || AVOID_WORDS.has(cleanWord)) continue;

    // Look up in dictionary
    const entry = lookupWord(cleanWord);

    if (entry) {
      // Found in dictionary - use rank to find rarest
      if (entry.rank < bestRank) {
        bestRank = entry.rank;
        bestWord = { word: words[i], index: i, rank: entry.rank };
      }
    } else if (bestRank === Infinity) {
      // Not in dictionary - only use if we haven't found anything in dictionary
      // Prefer longer words
      if (cleanWord.length > bestWord.word.length) {
        bestWord = { word: words[i], index: i, rank: undefined };
      }
    }
  }

  return bestWord;
}

/**
 * Determine which collection a sentence belongs to based on its cloze word rank
 */
export function getCollectionForRank(rank: number | undefined): ClozeCollection {
  if (rank === undefined) return 'random';
  if (rank <= 500) return 'top500';
  if (rank <= 1000) return 'top1000';
  if (rank <= 2000) return 'top2000';
  return 'random';
}

export interface ProcessedSentence extends TatoebaSentence {
  clozeWord: string;
  clozeIndex: number;
  wordRank: number | undefined;
  collection: ClozeCollection;
}

/**
 * Process sentences to find best cloze word and categorize
 */
export function processSentencesForCloze(sentences: TatoebaSentence[]): ProcessedSentence[] {
  return sentences
    .filter(s => s.translation && s.text.split(/\s+/).length >= 4)
    .map(s => {
      const { word, index, rank } = findBestClozeWord(s.text);
      return {
        ...s,
        clozeWord: word,
        clozeIndex: index,
        wordRank: rank,
        collection: getCollectionForRank(rank),
      };
    });
}

/**
 * Fetch multiple pages of sentences from Tatoeba
 * @param pages - Number of pages to fetch (each page = 100 sentences)
 * @param onProgress - Callback for progress updates
 */
export async function fetchBulkSentences(
  pages: number = 5,
  onProgress?: (current: number, total: number) => void
): Promise<ProcessedSentence[]> {
  const allSentences: TatoebaSentence[] = [];
  const seenIds = new Set<number>();

  for (let page = 1; page <= pages; page++) {
    if (onProgress) onProgress(page, pages);

    try {
      const response = await fetch(`${API_URL}?limit=100`);

      if (!response.ok) continue;

      const data = await response.json();
      const sentences = data.sentences || [];

      for (const sentence of sentences) {
        if (seenIds.has(sentence.id)) continue;
        seenIds.add(sentence.id);

        if (sentence.translation) {
          allSentences.push(sentence);
        }
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.error(`Failed to fetch page ${page}:`, error);
    }
  }

  return processSentencesForCloze(allSentences);
}

/**
 * Search for Afrikaans sentences containing a specific word
 * @param word - The word to search for
 * @returns Array of sentences containing the word with English translations
 */
export async function searchSentences(word: string): Promise<TatoebaSentence[]> {
  try {
    const params = new URLSearchParams({
      query: word,
      limit: "20",
    });

    const response = await fetch(`${API_URL}?${params.toString()}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    const data = await response.json();
    return data.sentences || [];
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        "Could not connect to server. Check your internet connection."
      );
    }
    throw error;
  }
}
