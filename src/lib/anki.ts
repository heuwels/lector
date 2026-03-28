// AnkiConnect API client — direct browser-to-local connection
// AnkiConnect must be running on localhost:8765
// In Anki: Tools > Add-ons > AnkiConnect > Config, ensure webCorsOriginList includes "*" or your app origin

const ANKI_CONNECT_URL = 'http://localhost:8765';

interface AnkiConnectResponse<T = unknown> {
  result: T;
  error: string | null;
}

interface CardInfo {
  cardId: number;
  fields: Record<string, { value: string; order: number }>;
  interval: number;
  note: number;
  deckName: string;
}

/**
 * Make a request directly to AnkiConnect on localhost
 */
async function ankiRequest<T>(
  action: string,
  params?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(ANKI_CONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect error: ${response.status}`);
  }

  const data = (await response.json()) as AnkiConnectResponse<T>;

  if (data.error) {
    throw new Error(`AnkiConnect error: ${data.error}`);
  }

  return data.result;
}

/**
 * Check if Anki is running and AnkiConnect is available
 */
export async function isAnkiConnected(): Promise<boolean> {
  try {
    const response = await fetch(ANKI_CONNECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'version', version: 6 }),
    });
    const data = await response.json();
    return data.result != null && data.error == null;
  } catch {
    return false;
  }
}

/**
 * Get all deck names from Anki
 */
export async function getDeckNames(): Promise<string[]> {
  return ankiRequest<string[]>('deckNames');
}

/**
 * Create a deck if it doesn't exist
 * @param deckName - Name of the deck to create
 */
async function ensureDeckExists(deckName: string): Promise<void> {
  await ankiRequest("createDeck", { deck: deckName });
}

/**
 * Add a basic (front/back) card to Anki
 * @param deckName - Name of the deck to add the card to
 * @param sentence - The Afrikaans sentence containing the target word
 * @param targetWord - The word being learned
 * @param translation - English translation of the sentence
 * @param wordMeaning - English meaning of the target word
 * @returns The note ID of the created card
 */
export async function addBasicCard(
  deckName: string,
  sentence: string,
  targetWord: string,
  translation: string,
  wordMeaning: string
): Promise<number> {
  console.log(`[Anki] Adding basic card to deck "${deckName}" for word "${targetWord}"`);

  await ensureDeckExists(deckName);

  // Highlight the target word in the sentence
  const highlightedSentence = sentence.replace(
    new RegExp(`\\b(${escapeRegex(targetWord)})\\b`, "gi"),
    "<b>$1</b>"
  );

  const noteId = await ankiRequest<number | null>("addNote", {
    note: {
      deckName,
      modelName: "Basic",
      fields: {
        Front: `${highlightedSentence}<br><br><small>Word: <b>${targetWord}</b></small>`,
        Back: `${translation}<br><br><b>${targetWord}</b> = ${wordMeaning}`,
      },
      options: {
        allowDuplicate: true, // Allow duplicates - same word from different sentences is fine
      },
      tags: ["afrikaans-reader", "vocabulary"],
    },
  });

  // AnkiConnect returns null if the note couldn't be added
  if (noteId === null) {
    throw new Error("Failed to add note - check that 'Basic' note type exists with 'Front' and 'Back' fields");
  }

  console.log(`[Anki] Successfully added basic note with ID: ${noteId}`);
  return noteId;
}

/**
 * Add a cloze deletion card to Anki
 * @param deckName - Name of the deck to add the card to
 * @param sentence - The Afrikaans sentence containing the target word
 * @param targetWord - The word being learned (will be hidden in cloze)
 * @param translation - English translation of the sentence
 * @param wordMeaning - English meaning of the target word
 * @returns The note ID of the created card
 */
export async function addClozeCard(
  deckName: string,
  sentence: string,
  targetWord: string,
  translation: string,
  wordMeaning: string
): Promise<number> {
  console.log(`[Anki] Adding cloze card to deck "${deckName}" for word "${targetWord}"`);

  await ensureDeckExists(deckName);

  // Create cloze deletion by replacing the target word
  const clozeText = sentence.replace(
    new RegExp(`\\b(${escapeRegex(targetWord)})\\b`, "gi"),
    "{{c1::$1}}"
  );

  console.log(`[Anki] Cloze text: ${clozeText}`);

  const noteId = await ankiRequest<number | null>("addNote", {
    note: {
      deckName,
      modelName: "Cloze",
      fields: {
        Text: `${clozeText}<br><br><small>Translation: ${translation}</small>`,
        Extra: `<b>${targetWord}</b> = ${wordMeaning}`,
      },
      options: {
        allowDuplicate: true, // Allow duplicates - user may want the same word from different sentences
      },
      tags: ["afrikaans-reader", "vocabulary", "cloze"],
    },
  });

  // AnkiConnect returns null if the note couldn't be added
  if (noteId === null) {
    throw new Error("Failed to add note - check that 'Cloze' note type exists with 'Text' and 'Extra' fields");
  }

  console.log(`[Anki] Successfully added note with ID: ${noteId}`);
  return noteId;
}

/**
 * Get word states based on Anki intervals for syncing mastery levels
 * This queries Anki for cards with the afrikaans-reader tag and returns
 * their intervals, which can be used to determine mastery level
 */
export async function syncWordStates(deckName?: string): Promise<
  Map<string, { interval: number; deckName: string }>
> {
  // Find cards - either by tag or by deck name
  let query = "tag:afrikaans-reader";
  if (deckName) {
    // Search in the specified deck OR with our tag
    query = `("deck:${deckName}" OR tag:afrikaans-reader)`;
  }

  console.log(`Anki sync query: ${query}`);
  const cardIds = await ankiRequest<number[]>("findCards", { query });
  console.log(`Found ${cardIds.length} cards in Anki`);

  if (cardIds.length === 0) {
    return new Map();
  }

  // Get card info
  const cardsInfo = await ankiRequest<CardInfo[]>("cardsInfo", {
    cards: cardIds,
  });

  // Build a map of word -> interval
  const wordStates = new Map<string, { interval: number; deckName: string }>();

  for (const card of cardsInfo) {
    // Extract the target word from the card
    // Try multiple strategies:
    // 1. Look for bold text (our format): <b>word</b>
    // 2. Look for a "Word" field
    // 3. Use plain Front field (typical vocab cards)
    // 4. Use plain Text field (cloze cards)

    let word: string | null = null;

    const frontField = card.fields["Front"]?.value || "";
    const textField = card.fields["Text"]?.value || "";
    const wordField = card.fields["Word"]?.value || "";

    // Strategy 1: Bold text in front/text field
    const boldMatch = (frontField || textField).match(/<b>([^<]+)<\/b>/);
    if (boldMatch) {
      word = boldMatch[1];
    }
    // Strategy 2: Dedicated Word field
    else if (wordField) {
      word = wordField.replace(/<[^>]*>/g, '').trim(); // Strip HTML
    }
    // Strategy 3: Plain front field (single word or short phrase)
    else if (frontField) {
      // Strip HTML and get first word if it's just a simple vocab card
      const plainText = frontField.replace(/<[^>]*>/g, '').trim();
      // Only use if it looks like a single word/short phrase (no sentences)
      if (plainText.length < 50 && !plainText.includes('.')) {
        word = plainText.split(/\s+/)[0]; // Get first word
      }
    }
    // Strategy 4: Cloze - extract from {{c1::word}} pattern
    else if (textField) {
      const clozeMatch = textField.match(/\{\{c\d+::([^}]+)\}\}/);
      if (clozeMatch) {
        word = clozeMatch[1];
      }
    }

    if (word) {
      word = word.toLowerCase().trim();
      // Keep the card with the highest interval (most learned)
      const existing = wordStates.get(word);
      if (!existing || card.interval > existing.interval) {
        wordStates.set(word, {
          interval: card.interval,
          deckName: card.deckName,
        });
      }
    }
  }

  console.log(`Extracted ${wordStates.size} unique words from Anki cards:`,
    Array.from(wordStates.keys()).slice(0, 10).join(', ') + (wordStates.size > 10 ? '...' : ''));
  return wordStates;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
