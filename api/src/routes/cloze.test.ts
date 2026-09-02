import '../test-guard';
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { db } from '../db';
import {
  makeEntitlements,
  NO_STORAGE_LIMITS,
  setEntitlementsEngineForTests,
  type PlanLimits,
} from '../lib/entitlements';

// The per-language sentence bank is lazily imported by the seed route. Mock the
// Afrikaans bank down to a tiny fixture (2 Tatoeba rows + 1 mined row) so the
// test doesn't seed the full ~11k-row bank.
const TATOEBA_IDS = [9001, 9002];
const MINED_ID = 'afm-test-001';
// Mined rows are stored under a per-tenant namespaced id (#220) — these tests
// run in selfhost mode, so the stored PK is the 'local' user's namespace.
const STORED_MINED_ID = `mined:local:${MINED_ID}`;
const DE_TATOEBA_IDS = [7001, 7002];
const EO_TATOEBA_IDS = [8001, 8002];
const FR_TATOEBA_IDS = [6001, 6002];
const IT_TATOEBA_IDS = [4001, 4002];
const NL_TATOEBA_IDS = [5001, 5002];
const PT_TATOEBA_IDS = [4001, 4002];
const RU_TATOEBA_IDS = [3001, 3002];
const TR_TATOEBA_IDS = [2001, 2002];
const UK_TATOEBA_IDS = [1001, 1002];
const PL_TATOEBA_IDS = [1201, 1202];
const CS_TATOEBA_IDS = [1301, 1302];
const ID_TATOEBA_IDS = [1401, 1402];
const SV_TATOEBA_IDS = [1501, 1502];
const LA_TATOEBA_IDS = [1601, 1602];
const HI_TATOEBA_IDS = [1701, 1702];
const EL_TATOEBA_IDS = [1801, 1802];
const FI_TATOEBA_IDS = [1901, 1902];
const HU_TATOEBA_IDS = [2101, 2102];
const GRC_VERSE_IDS = [40010010, 40030160];

mock.module('../lib/sentence-bank-af.json', () => ({
  default: [
    {
      id: 9001,
      text: 'Die kat sit op die mat.',
      translation: 'The cat sits on the mat.',
      clozeWord: 'kat',
      clozeIndex: 1,
      wordRank: 50,
      collection: 'top500',
    },
    {
      id: 9002,
      text: 'Ek drink water.',
      translation: 'I drink water.',
      clozeWord: 'water',
      clozeIndex: 2,
      wordRank: 120,
      collection: 'top500',
    },
    {
      id: MINED_ID,
      text: 'Die hond is lekker.',
      translation: 'The dog is nice.',
      clozeWord: 'hond',
      clozeIndex: 1,
      wordRank: 300,
      collection: 'top1000',
      source: 'mined',
    },
  ],
}));

// German bank fixture (2 rows) — proves per-language seeding + isolation.
mock.module('../lib/sentence-bank-de.json', () => ({
  default: [
    {
      id: 7001,
      text: 'Das Haus ist groß.',
      translation: 'The house is big.',
      clozeWord: 'Haus',
      clozeIndex: 1,
      wordRank: 40,
      collection: 'top500',
    },
    {
      id: 7002,
      text: 'Ich trinke Wasser.',
      translation: 'I drink water.',
      clozeWord: 'Wasser',
      clozeIndex: 2,
      wordRank: 90,
      collection: 'top500',
    },
  ],
}));

// Spanish ships a real bank in production (sentence-bank-es.json); mocked empty
// here so the "no usable bank" test below exercises the seeds-nothing guard
// without importing the full ~8k-row bank.
mock.module('../lib/sentence-bank-es.json', () => ({ default: [] }));

// French bank fixture (2 rows) — proves the fourth language seeds under fr and
// stays isolated, once its bank is registered in SENTENCE_BANKS (the one-line
// cloze.ts change); everything else about fr is registry-derived.
mock.module('../lib/sentence-bank-fr.json', () => ({
  default: [
    {
      id: 6001,
      text: 'Le chat dort sur le lit.',
      translation: 'The cat sleeps on the bed.',
      clozeWord: 'chat',
      clozeIndex: 1,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 6002,
      text: 'Je bois du café chaud.',
      translation: 'I drink hot coffee.',
      clozeWord: 'café',
      clozeIndex: 3,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Italian bank fixture (2 rows) — proves the sixth language seeds under it and
// stays isolated, once its bank is registered in SENTENCE_BANKS.
mock.module('../lib/sentence-bank-it.json', () => ({
  default: [
    {
      id: 4001,
      text: "L'acqua è fresca.",
      translation: 'The water is fresh.',
      clozeWord: "L'acqua",
      clozeIndex: 0,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 4002,
      text: 'Bevo il caffè caldo.',
      translation: 'I drink hot coffee.',
      clozeWord: 'caffè',
      clozeIndex: 2,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Dutch bank fixture (2 rows) — proves the fifth language seeds under nl and
// stays isolated, once its bank is registered in SENTENCE_BANKS (the one-line
// cloze.ts change); everything else about nl is registry-derived.
mock.module('../lib/sentence-bank-nl.json', () => ({
  default: [
    {
      id: 5001,
      text: 'De kat slaapt op het bed.',
      translation: 'The cat sleeps on the bed.',
      clozeWord: 'kat',
      clozeIndex: 1,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 5002,
      text: 'Ik drink warme koffie.',
      translation: 'I drink hot coffee.',
      clozeWord: 'koffie',
      clozeIndex: 3,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Portuguese bank fixture (2 rows) — proves the sixth language seeds under pt and
// stays isolated, once its bank is registered in SENTENCE_BANKS (the one-line
// cloze.ts change); everything else about pt is registry-derived.
mock.module('../lib/sentence-bank-pt.json', () => ({
  default: [
    {
      id: 4001,
      text: 'O gato dorme na cama.',
      translation: 'The cat sleeps on the bed.',
      clozeWord: 'gato',
      clozeIndex: 1,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 4002,
      text: 'Eu bebo café quente.',
      translation: 'I drink hot coffee.',
      clozeWord: 'café',
      clozeIndex: 2,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Esperanto bank fixture (2 rows) — proves the eighth language seeds under eo
// and stays isolated, once its bank is registered in SENTENCE_BANKS (the
// one-line cloze.ts change); everything else about eo is registry-derived.
// The supersignoj in the fixture also prove the seed path stores them intact.
mock.module('../lib/sentence-bank-eo.json', () => ({
  default: [
    {
      id: 8001,
      text: 'La kato dormas sur la lito.',
      translation: 'The cat sleeps on the bed.',
      clozeWord: 'kato',
      clozeIndex: 1,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 8002,
      text: 'Mi trinkas varman ĉokoladon.',
      translation: 'I drink hot chocolate.',
      clozeWord: 'ĉokoladon',
      clozeIndex: 3,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Russian bank fixture (2 rows) — proves the ninth language seeds under ru and
// stays isolated, once its bank is registered in SENTENCE_BANKS (the one-line
// cloze.ts change); everything else about ru is registry-derived. The Cyrillic
// fixture (with ё) also proves the seed path stores non-Latin text intact.
mock.module('../lib/sentence-bank-ru.json', () => ({
  default: [
    {
      id: 3001,
      text: 'Кошка спит на кровати.',
      translation: 'The cat sleeps on the bed.',
      clozeWord: 'Кошка',
      clozeIndex: 0,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 3002,
      text: 'Я пью тёплое молоко.',
      translation: 'I drink warm milk.',
      clozeWord: 'тёплое',
      clozeIndex: 2,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Koine Greek bank fixture (2 rows) — proves the tenth language seeds under
// grc and stays isolated, once its bank is registered in SENTENCE_BANKS (the
// one-line cloze.ts change). The polytonic fixture also proves the seed path
// stores breathings/accents byte-intact, and the verse-derived numeric ids
// coexist with Tatoeba ids.
mock.module('../lib/sentence-bank-grc.json', () => ({
  default: [
    {
      id: 40010010,
      text: 'Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν.',
      translation: 'In the beginning was the Word, and the Word was with God. (John 1:1)',
      clozeWord: 'λόγος,',
      clozeIndex: 4,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 40030160,
      text: 'οὕτως γὰρ ἠγάπησεν ὁ θεὸς τὸν κόσμον.',
      translation: 'For God so loved the world. (John 3:16)',
      clozeWord: 'κόσμον.',
      clozeIndex: 6,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Turkish bank fixture (2 rows) — proves the eleventh language seeds under tr
// and stays isolated, once its bank is registered in SENTENCE_BANKS (the
// one-line cloze.ts change). Both rows carry a capitalized dotted İ, which is
// where a default lowercasing would leave a combining dot behind: the seed path
// must store the text exactly as written and let the pack fold it at grading
// time.
mock.module('../lib/sentence-bank-tr.json', () => ({
  default: [
    {
      id: 2001,
      text: 'İyi sağlık her şeyden daha değerlidir.',
      translation: 'Good health is more valuable than anything else.',
      clozeWord: 'İyi',
      clozeIndex: 0,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 2002,
      text: 'Işık söndü ve oda karanlık oldu.',
      translation: 'The light went out and the room went dark.',
      clozeWord: 'Işık',
      clozeIndex: 0,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Ukrainian bank fixture (2 rows) — proves the twelfth language seeds under uk
// and stays isolated, once its bank is registered in SENTENCE_BANKS (the
// one-line cloze.ts change). Both rows carry an apostrophe word, which is where
// the pack's joiner matters: the seed path must store the text exactly as
// written, apostrophe included, and let the pack fold the variant at grading
// time.
mock.module('../lib/sentence-bank-uk.json', () => ({
  default: [
    {
      id: 1001,
      text: "Я з'їв п'ять яблук сьогодні.",
      translation: 'I ate five apples today.',
      clozeWord: "п'ять",
      clozeIndex: 2,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 1002,
      text: 'Здоров’я важливіше за все інше.',
      translation: 'Health is more important than everything else.',
      clozeWord: 'Здоров’я',
      clozeIndex: 0,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Polish bank fixture (2 rows) — proves the thirteenth language seeds under pl
// and stays isolated, once its bank is registered in SENTENCE_BANKS (the
// one-line cloze.ts change). One row carries a diacritic answer and one a
// foreign stem with a Polish case ending, so the seed path is shown to store
// both exactly as written.
mock.module('../lib/sentence-bank-pl.json', () => ({
  default: [
    {
      id: 1201,
      text: 'Kupiłem nową książkę za pięćdziesiąt złotych.',
      translation: 'I bought a new book for fifty zloty.',
      clozeWord: 'książkę',
      clozeIndex: 2,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 1202,
      text: "Czytałem powieść Joyce'a w zeszłym roku.",
      translation: "I read Joyce's novel last year.",
      clozeWord: 'powieść',
      clozeIndex: 1,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Czech bank fixture (2 rows) — proves the fourteenth language seeds under cs
// and stays isolated, once its bank is registered in SENTENCE_BANKS (the
// one-line cloze.ts change). One answer carries a contrastive long vowel and one
// carries a háček plus a kroužek, so the seed path is shown to store the Czech
// diacritics precomposed and unchanged.
mock.module('../lib/sentence-bank-cs.json', () => ({
  default: [
    {
      id: 1301,
      text: 'Koupil jsem novou knihu za padesát korun.',
      translation: 'I bought a new book for fifty crowns.',
      clozeWord: 'knihu',
      clozeIndex: 3,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 1302,
      text: 'Ten kůň běžel přes celé pole.',
      translation: 'That horse ran across the whole field.',
      clozeWord: 'kůň',
      clozeIndex: 1,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

mock.module('../lib/sentence-bank-id.json', () => ({
  default: [
    {
      id: 1401,
      text: 'Saya membeli buku baru di toko.',
      translation: 'I bought a new book at the shop.',
      clozeWord: 'membeli',
      clozeIndex: 1,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 1402,
      text: 'Mereka membaca buku-buku itu setiap hari.',
      translation: 'They read those books every day.',
      clozeWord: 'buku-buku',
      clozeIndex: 2,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

mock.module('../lib/sentence-bank-sv.json', () => ({
  default: [
    {
      id: 1501,
      text: 'Jag köpte en ny bok i går.',
      translation: 'I bought a new book yesterday.',
      clozeWord: 'bok',
      clozeIndex: 4,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 1502,
      text: 'Här är en röd björn.',
      translation: 'Here is a red bear.',
      clozeWord: 'björn',
      clozeIndex: 4,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

mock.module('../lib/sentence-bank-la.json', () => ({
  default: [
    {
      id: 1601,
      text: 'Gallia est omnis divisa in partes tres.',
      translation: 'Gaul as a whole is divided into three parts.',
      clozeWord: 'partes',
      clozeIndex: 5,
      wordRank: 65,
      collection: 'top500',
    },
    {
      id: 1602,
      text: 'Arma virumque cano.',
      translation: 'I sing of arms and the man.',
      clozeWord: 'arma',
      clozeIndex: 0,
      wordRank: 98,
      collection: 'top500',
    },
  ],
}));

mock.module('../lib/sentence-bank-hi.json', () => ({
  default: [
    {
      id: 1701,
      text: 'मैं एक किताब पढ़ता हूँ।',
      translation: 'I read a book.',
      clozeWord: 'किताब',
      clozeIndex: 2,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 1702,
      text: 'यह पानी ठंडा है।',
      translation: 'This water is cold.',
      clozeWord: 'पानी',
      clozeIndex: 1,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

mock.module('../lib/sentence-bank-el.json', () => ({
  default: [
    {
      id: 1801,
      text: 'Διαβάζω ένα καλό βιβλίο.',
      translation: 'I read a good book.',
      clozeWord: 'βιβλίο',
      clozeIndex: 3,
      wordRank: 40,
      collection: 'top500',
    },
    {
      id: 1802,
      text: 'Το σπίτι είναι μεγάλο.',
      translation: 'The house is big.',
      clozeWord: 'σπίτι',
      clozeIndex: 1,
      wordRank: 90,
      collection: 'top500',
    },
  ],
}));

mock.module('../lib/sentence-bank-fi.json', () => ({
  default: [
    {
      id: 1901,
      text: 'Ostin uuden kirjan eilen.',
      translation: 'I bought a new book yesterday.',
      clozeWord: 'kirjan',
      clozeIndex: 2,
      wordRank: 35,
      collection: 'top500',
    },
    {
      id: 1902,
      text: 'Tämä päivä on kaunis.',
      translation: 'This day is beautiful.',
      clozeWord: 'päivä',
      clozeIndex: 1,
      wordRank: 80,
      collection: 'top500',
    },
  ],
}));

mock.module('../lib/sentence-bank-hu.json', () => ({
  default: [
    {
      id: 2101,
      text: 'Vettem egy új könyvet.',
      translation: 'I bought a new book.',
      clozeWord: 'könyvet',
      clozeIndex: 3,
      wordRank: 50,
      collection: 'top500',
    },
    {
      id: 2102,
      text: 'A ház a kertben áll.',
      translation: 'The house stands in the garden.',
      clozeWord: 'ház',
      clozeIndex: 1,
      wordRank: 70,
      collection: 'top500',
    },
  ],
}));

const { default: app } = await import('../routes/cloze');

function setActiveLanguage(code: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'targetLanguage',
    JSON.stringify(code),
  );
}

function reset() {
  db.prepare(
    `DELETE FROM clozeSentences WHERE tatoebaSentenceId IN (${[...TATOEBA_IDS, ...DE_TATOEBA_IDS, ...EO_TATOEBA_IDS, ...FR_TATOEBA_IDS, ...IT_TATOEBA_IDS, ...NL_TATOEBA_IDS, ...PT_TATOEBA_IDS, ...RU_TATOEBA_IDS, ...TR_TATOEBA_IDS, ...UK_TATOEBA_IDS, ...PL_TATOEBA_IDS, ...CS_TATOEBA_IDS, ...ID_TATOEBA_IDS, ...SV_TATOEBA_IDS, ...LA_TATOEBA_IDS, ...HI_TATOEBA_IDS, ...EL_TATOEBA_IDS, ...FI_TATOEBA_IDS, ...HU_TATOEBA_IDS, ...GRC_VERSE_IDS].join(',')}) OR id IN (?, ?)`,
  ).run(MINED_ID, STORED_MINED_ID);
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
}

describe('POST /api/cloze/seed — lazy per-language bank', () => {
  beforeEach(reset);
  afterEach(reset);

  test('seeds the active language bank and stores rows under that language', async () => {
    setActiveLanguage('af');

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seeded: number; mined: number; tatoeba: number };
    expect(body.seeded).toBe(3);
    expect(body.tatoeba).toBe(2);
    expect(body.mined).toBe(1);

    const tat = db
      .prepare(
        `SELECT language, source FROM clozeSentences WHERE tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; source: string }[];
    expect(tat.length).toBe(2);
    expect(tat.every((r) => r.language === 'af' && r.source === 'tatoeba')).toBe(true);

    const mined = db
      .prepare('SELECT id, language, source, collection FROM clozeSentences WHERE id = ?')
      .get(STORED_MINED_ID) as { id: string; language: string; source: string; collection: string };
    expect(mined).toBeTruthy();
    expect(mined.source).toBe('mined');
    expect(mined.language).toBe('af');
    expect(mined.collection).toBe('top1000');
  });

  test('seeds nothing when the active language has no bank (no mislabeling)', async () => {
    // A registered language whose bank has no usable sentences (es is mocked to
    // an empty bank above) simply seeds nothing, so one language's content can
    // never land under another.
    setActiveLanguage('es');

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(0);

    const count = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE tatoebaSentenceId IN (${TATOEBA_IDS.join(',')}) OR id = ?`,
      )
      .get(STORED_MINED_ID) as { c: number };
    expect(count.c).toBe(0);
  });

  test('seeds the German bank under de, isolated from Afrikaans (no cross-bleed)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('de');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const de = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${DE_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(de.length).toBe(2);
    expect(de.every((r) => r.language === 'de')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under de.
    const afUnderDe = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'de' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderDe.c).toBe(0);
  });

  test('seeds the French bank under fr, isolated from Afrikaans (fourth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('fr');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const fr = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${FR_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(fr.length).toBe(2);
    expect(fr.every((r) => r.language === 'fr')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under fr.
    const afUnderFr = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'fr' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderFr.c).toBe(0);
  });

  test('seeds the Dutch bank under nl, isolated from Afrikaans (fifth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('nl');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const nl = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${NL_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(nl.length).toBe(2);
    expect(nl.every((r) => r.language === 'nl')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under nl.
    const afUnderNl = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'nl' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderNl.c).toBe(0);
  });

  test('seeds the Italian bank under it, isolated from Afrikaans (sixth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('it');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const it = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${IT_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(it.length).toBe(2);
    expect(it.every((row) => row.language === 'it')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under it.
    const afUnderIt = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'it' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderIt.c).toBe(0);
  });

  test('seeds the Portuguese bank under pt, isolated from Afrikaans (seventh language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('pt');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const pt = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${PT_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(pt.length).toBe(2);
    expect(pt.every((r) => r.language === 'pt')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under pt.
    const afUnderPt = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'pt' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderPt.c).toBe(0);
  });

  test('seeds the Esperanto bank under eo, isolated from Afrikaans (eighth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('eo');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const eo = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${EO_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(eo.length).toBe(2);
    expect(eo.every((r) => r.language === 'eo')).toBe(true);
    // Supersignoj survive the seed path byte-intact.
    expect(eo.some((r) => r.clozeWord === 'ĉokoladon')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under eo.
    const afUnderEo = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'eo' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderEo.c).toBe(0);
  });

  test('seeds the Russian bank under ru, isolated from Afrikaans (ninth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('ru');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const ru = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${RU_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(ru.length).toBe(2);
    expect(ru.every((r) => r.language === 'ru')).toBe(true);
    // Cyrillic (including ё) survives the seed path byte-intact.
    expect(ru.some((r) => r.clozeWord === 'тёплое')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under ru.
    const afUnderRu = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'ru' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderRu.c).toBe(0);
  });

  test('seeds the Greek verse bank under grc, isolated from Afrikaans (tenth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('grc');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const grc = db
      .prepare(
        `SELECT language, clozeWord, translation FROM clozeSentences WHERE tatoebaSentenceId IN (${GRC_VERSE_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string; translation: string }[];
    expect(grc.length).toBe(2);
    expect(grc.every((r) => r.language === 'grc')).toBe(true);
    // Polytonic marks survive the seed path byte-intact, and the verse ref
    // provenance rides in the translation.
    expect(grc.some((r) => r.clozeWord === 'λόγος,')).toBe(true);
    expect(grc.some((r) => r.translation.endsWith('(John 1:1)'))).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under grc.
    const afUnderGrc = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'grc' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderGrc.c).toBe(0);
  });

  test('seeds the Turkish bank under tr, isolated from Afrikaans (eleventh language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('tr');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const tr = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${TR_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(tr.length).toBe(2);
    expect(tr.every((r) => r.language === 'tr')).toBe(true);
    // The dotted İ and dotless I are stored exactly as written — one precomposed
    // character each, with no combining dot introduced by a stray lowercasing.
    expect(tr.some((r) => r.clozeWord === 'İyi')).toBe(true);
    expect(tr.some((r) => r.clozeWord === 'Işık')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under tr.
    const afUnderTr = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'tr' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderTr.c).toBe(0);
  });

  test('seeds the Ukrainian bank under uk, isolated from Russian (twelfth language)', async () => {
    // Russian is the pack a Ukrainian learner reached for before this existed,
    // so it is the isolation partner worth asserting.
    setActiveLanguage('ru');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('uk');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const uk = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${UK_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(uk.length).toBe(2);
    expect(uk.every((r) => r.language === 'uk')).toBe(true);
    // The apostrophe survives the seed path in the exact variant the bank wrote,
    // ASCII in one row and typographic in the other.
    expect(uk.some((r) => r.clozeWord === "п'ять")).toBe(true);
    expect(uk.some((r) => r.clozeWord === 'Здоров’я')).toBe(true);

    // Zero cross-bleed: Russian content never lands under uk.
    const ruUnderUk = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'uk' AND tatoebaSentenceId IN (${RU_TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(ruUnderUk.c).toBe(0);
  });

  test('seeds the Polish bank under pl, isolated from Afrikaans (thirteenth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('pl');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const pl = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${PL_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(pl.length).toBe(2);
    expect(pl.every((r) => r.language === 'pl')).toBe(true);
    // Diacritics are stored precomposed, exactly as the bank wrote them.
    expect(pl.some((r) => r.clozeWord === 'książkę')).toBe(true);
    expect(pl.some((r) => r.clozeWord === 'powieść')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under pl.
    const afUnderPl = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'pl' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderPl.c).toBe(0);
  });

  test('seeds the Czech bank under cs, isolated from Polish (fourteenth language)', async () => {
    setActiveLanguage('pl');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('cs');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const cs = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${CS_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(cs.length).toBe(2);
    expect(cs.every((r) => r.language === 'cs')).toBe(true);
    // Diacritics are stored precomposed, exactly as the bank wrote them.
    expect(cs.some((r) => r.clozeWord === 'knihu')).toBe(true);
    expect(cs.some((r) => r.clozeWord === 'kůň')).toBe(true);

    // Zero cross-bleed: Polish content never lands under cs. The two packs are
    // the closest pair in the registry — same family, same seams — so this is
    // the isolation check that matters most.
    const plUnderCs = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'cs' AND tatoebaSentenceId IN (${PL_TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(plUnderCs.c).toBe(0);
  });

  test('seeds the Indonesian bank under id, isolated from Czech', async () => {
    setActiveLanguage('cs');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('id');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const id = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${ID_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(id.length).toBe(2);
    expect(id.every((r) => r.language === 'id')).toBe(true);
    expect(id.some((r) => r.clozeWord === 'membeli')).toBe(true);
    expect(id.some((r) => r.clozeWord === 'buku-buku')).toBe(true);

    const csUnderId = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'id' AND tatoebaSentenceId IN (${CS_TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(csUnderId.c).toBe(0);
  });

  test('seeds the Swedish bank under sv, isolated from Indonesian', async () => {
    setActiveLanguage('id');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('sv');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const sv = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${SV_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(sv.length).toBe(2);
    expect(sv.every((r) => r.language === 'sv')).toBe(true);
    expect(sv.some((r) => r.clozeWord === 'bok')).toBe(true);
    expect(sv.some((r) => r.clozeWord === 'björn')).toBe(true);

    const idUnderSv = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'sv' AND tatoebaSentenceId IN (${ID_TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(idUnderSv.c).toBe(0);
  });

  test('seeds the Latin bank under la, isolated from Swedish', async () => {
    setActiveLanguage('sv');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('la');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const la = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${LA_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(la.length).toBe(2);
    expect(la.every((r) => r.language === 'la')).toBe(true);
    expect(la.some((r) => r.clozeWord === 'partes')).toBe(true);
    expect(la.some((r) => r.clozeWord === 'arma')).toBe(true);

    const svUnderLa = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'la' AND tatoebaSentenceId IN (${SV_TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(svUnderLa.c).toBe(0);
  });

  test('seeds the Hindi bank under hi, isolated from Latin', async () => {
    setActiveLanguage('la');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('hi');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const hi = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${HI_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(hi.length).toBe(2);
    expect(hi.every((r) => r.language === 'hi')).toBe(true);
    expect(hi.some((r) => r.clozeWord === 'किताब')).toBe(true);
    expect(hi.some((r) => r.clozeWord === 'पानी')).toBe(true);

    const laUnderHi = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'hi' AND tatoebaSentenceId IN (${LA_TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(laUnderHi.c).toBe(0);
  });

  test('seeds the Greek bank under el, isolated from Koine', async () => {
    setActiveLanguage('grc');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('el');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const greek = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${EL_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(greek.length).toBe(2);
    expect(greek.every((r) => r.language === 'el')).toBe(true);
    expect(greek.some((r) => r.clozeWord === 'βιβλίο')).toBe(true);
    expect(greek.some((r) => r.clozeWord === 'σπίτι')).toBe(true);

    const grcUnderEl = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'el' AND tatoebaSentenceId IN (${GRC_VERSE_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(grcUnderEl.c).toBe(0);
  });

  test('seeds the Finnish bank under fi, isolated from Swedish', async () => {
    setActiveLanguage('sv');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('fi');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const fi = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${FI_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(fi.length).toBe(2);
    expect(fi.every((r) => r.language === 'fi')).toBe(true);
    expect(fi.some((r) => r.clozeWord === 'kirjan')).toBe(true);
    expect(fi.some((r) => r.clozeWord === 'päivä')).toBe(true);
  });

  test('seeds the Hungarian bank under hu, isolated from Finnish', async () => {
    setActiveLanguage('fi');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('hu');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const hu = db
      .prepare(
        `SELECT language, clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${HU_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; clozeWord: string }[];
    expect(hu.length).toBe(2);
    expect(hu.every((r) => r.language === 'hu')).toBe(true);
    expect(hu.some((r) => r.clozeWord === 'könyvet')).toBe(true);
    expect(hu.some((r) => r.clozeWord === 'ház')).toBe(true);
  });

  test('re-seeding is idempotent for mined entries', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    await app.request('/seed', { method: 'POST' });

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM clozeSentences WHERE id = ?')
      .get(STORED_MINED_ID) as { c: number };
    expect(count.c).toBe(1);
  });

  test('a mined row seeded before id namespacing is not duplicated on re-seed', async () => {
    setActiveLanguage('af');
    // Legacy row: the raw bank id, as pre-#220 seeds stored it.
    db.prepare(
      `INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, language, userId)
       VALUES (?, 'Ou saad-ry.', 'saad', 0, 'x', 'mined', 'top1000', ?, 'af', 'local')`,
    ).run(MINED_ID, new Date().toISOString());

    const body = (await (await app.request('/seed', { method: 'POST' })).json()) as {
      mined: number;
    };
    // The legacy raw-id row is recognized as already-seeded — no namespaced duplicate.
    expect(body.mined).toBe(0);

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM clozeSentences WHERE id IN (?, ?)')
      .get(MINED_ID, STORED_MINED_ID) as { c: number };
    expect(count.c).toBe(1);
  });
});

function makeFreeSeedEngine(limits: Partial<PlanLimits> = {}) {
  const plan = { ...NO_STORAGE_LIMITS, ...limits } as PlanLimits;
  return makeEntitlements({
    enforced: true,
    freeTierEnabled: true,
    exemptEmails: new Set(),
    prices: [],
    planLimits: { free: plan, cloud: plan, plus: plan },
    resolveEmail: () => null,
    isByok: () => false,
    compedPlan: () => null,
    now: () => new Date('2026-09-03T00:00:00Z'),
  });
}

describe('POST /api/cloze/seed — Free fair-use ceiling (#603)', () => {
  const FILLER_ID = 'seed-cap-filler';
  let restoreEngine: (() => void) | null = null;

  function clear() {
    reset();
    db.prepare('DELETE FROM clozeSentences WHERE id = ?').run(FILLER_ID);
    restoreEngine?.();
    restoreEngine = null;
  }

  beforeEach(clear);
  afterEach(clear);

  test('seeds the rows that fit instead of blocking Practice', async () => {
    restoreEngine = setEntitlementsEngineForTests(makeFreeSeedEngine({ maxClozeSentences: 2 }));
    setActiveLanguage('af');

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seeded: number; mined: number; tatoeba: number };
    expect(body.seeded).toBe(2);
    expect(body.tatoeba).toBe(2);
    expect(body.mined).toBe(0);

    const rows = db
      .prepare(
        `SELECT collection FROM clozeSentences WHERE tatoebaSentenceId IN (${TATOEBA_IDS.join(',')}) OR id = ?`,
      )
      .all(STORED_MINED_ID) as { collection: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.collection === 'top500')).toBe(true);
  });

  test('a second seed at the cap returns 200 and inserts nothing', async () => {
    restoreEngine = setEntitlementsEngineForTests(makeFreeSeedEngine({ maxClozeSentences: 2 }));
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seeded: 0, mined: 0, tatoeba: 0 });

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM clozeSentences WHERE userId = ?')
      .get('local') as { c: number };
    expect(count.c).toBe(2);
  });

  test('a later language still seeds into the remaining room', async () => {
    restoreEngine = setEntitlementsEngineForTests(makeFreeSeedEngine({ maxClozeSentences: 2 }));
    db.prepare(
      `INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, language, userId)
       VALUES (?, 'Filler.', 'Filler', 0, 'x', 'tatoeba', 'random', ?, 'de', 'local')`,
    ).run(FILLER_ID, new Date().toISOString());
    setActiveLanguage('hu');

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(1);

    const hu = db
      .prepare(
        `SELECT clozeWord FROM clozeSentences WHERE tatoebaSentenceId IN (${HU_TATOEBA_IDS.join(',')})`,
      )
      .all() as { clozeWord: string }[];
    expect(hu).toEqual([{ clozeWord: 'könyvet' }]);
  });
});

describe('GET /api/cloze/stats — server-side totals (#240)', () => {
  const clear = () =>
    db.prepare(`DELETE FROM clozeSentences WHERE id IN ('stat1','stat2','stat3')`).run();
  beforeEach(clear);
  afterEach(clear);

  test('sums timesCorrect/timesIncorrect for the language only', async () => {
    const insert = db.prepare(`
      INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, timesCorrect, timesIncorrect, language)
      VALUES (?, 's', 'w', 0, 't', 'tatoeba', 'random', '2026-01-01', ?, ?, ?)
    `);
    insert.run('stat1', 3, 1, 'af');
    insert.run('stat2', 4, 2, 'af');
    insert.run('stat3', 100, 100, 'de'); // other language — excluded

    const res = await app.request('/stats?language=af');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timesCorrect: 7, timesIncorrect: 3 });
  });

  test('empty table sums to zeros, not nulls', async () => {
    const res = await app.request('/stats?language=af');
    expect(await res.json()).toEqual({ timesCorrect: 0, timesIncorrect: 0 });
  });
});

describe('cloze display tokens (#289 4.3)', () => {
  const IDS = ['tok-legacy', 'tok-stored', 'tok-apostrophe'];
  const clear = () =>
    db
      .prepare(`DELETE FROM clozeSentences WHERE id IN (${IDS.map(() => '?').join(',')})`)
      .run(...IDS);
  beforeEach(clear);
  afterEach(clear);

  const insert = (
    id: string,
    sentence: string,
    clozeIndex: number,
    language: string,
    tokens: string | null,
  ) =>
    db
      .prepare(
        `INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, tokens, translation, source, collection, nextReview, language, userId)
         VALUES (?, ?, 'w', ?, ?, 't', 'tatoeba', 'random', '2026-01-01', ?, 'local')`,
      )
      .run(id, sentence, clozeIndex, tokens, language);

  test('a row with no stored tokens resolves to the whitespace split', async () => {
    // Every row seeded before 4.3 is this case. The array must be exactly what
    // `clozeIndex` was written against, or the blank moves.
    insert('tok-legacy', 'Die hond is groot.', 1, 'af', null);

    const res = await app.request('/tok-legacy?language=af');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: string[]; clozeIndex: number };
    expect(body.tokens).toEqual(['Die', 'hond', 'is', 'groot.']);
    expect(body.tokens[body.clozeIndex]).toBe('hond');
  });

  test('a French apostrophe row keeps its stored index pointing at the same word', async () => {
    // The regression this design exists to prevent: `L'eau` is 3 whitespace
    // tokens but 4 tokenizer tokens, so re-deriving would shift index 2.
    insert('tok-apostrophe', "L'eau est belle.", 2, 'fr', null);

    const res = await app.request('/tok-apostrophe?language=fr');
    const body = (await res.json()) as { tokens: string[]; clozeIndex: number };
    expect(body.tokens).toEqual(["L'eau", 'est', 'belle.']);
    expect(body.tokens[body.clozeIndex]).toBe('belle.');
  });

  test('a stored array is served verbatim and survives a JSON round trip', async () => {
    insert('tok-stored', '我喜欢读书。', 1, 'af', JSON.stringify(['我', '喜欢', '读书', '。']));

    const res = await app.request('/tok-stored?language=af');
    const body = (await res.json()) as { tokens: string[]; clozeIndex: number };
    expect(body.tokens).toEqual(['我', '喜欢', '读书', '。']);
    expect(body.tokens[body.clozeIndex]).toBe('喜欢');
    // Unspaced: the tokens rejoin with no separator.
    expect(body.tokens.join('')).toBe('我喜欢读书。');
  });

  test('a malformed stored array degrades to derivation instead of throwing', async () => {
    insert('tok-stored', 'Die hond is groot.', 0, 'af', '{not json');

    const res = await app.request('/tok-stored?language=af');
    expect(res.status).toBe(200);
    expect((await res.json()).tokens).toEqual(['Die', 'hond', 'is', 'groot.']);
  });

  test('the list route resolves tokens too, not just the by-id route', async () => {
    insert('tok-legacy', 'Die hond is groot.', 1, 'af', null);

    const res = await app.request('/?language=af');
    const rows = (await res.json()) as Array<{ id: string; tokens: string[] }>;
    const row = rows.find((r) => r.id === 'tok-legacy');
    expect(row?.tokens).toEqual(['Die', 'hond', 'is', 'groot.']);
  });
});
