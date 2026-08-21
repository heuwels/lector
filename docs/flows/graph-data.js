/**
 * Lector flow graph. Source of truth for the walkable explorer.
 * Classic script so index.html works from file:// (ES modules do not).
 *
 * Node kinds: app, layer, domain, flow, file, fn, route, table
 * Edge rels: contains, starts, then, calls, uses, opens, reads, writes, http, in, meters
 *
 * If you change a critical path, update this file and the matching .md notes.
 */
(function (global) {
  var nodes = [];
  var edges = [];
  var index = Object.create(null);
  var errors = [];

  function node(n) {
    if (index[n.id]) {
      errors.push("Duplicate node: " + n.id);
      return n.id;
    }
    nodes.push(n);
    index[n.id] = n;
    return n.id;
  }

  function edge(from, to, rel) {
    if (!index[from]) errors.push("Missing from: " + from + " -> " + to);
    if (!index[to]) errors.push("Missing to: " + from + " -> " + to);
    if (index[from] && index[to]) edges.push({ from: from, to: to, rel: rel });
  }

  function chain(ids, rel) {
    rel = rel || "then";
    for (var i = 0; i < ids.length - 1; i++) edge(ids[i], ids[i + 1], rel);
  }

  function N(id, kind, label, extra) {
    var n = { id: id, kind: kind, label: label };
    if (extra) {
      for (var k in extra) n[k] = extra[k];
    }
    return node(n);
  }

  // ── App and layers ────────────────────────────────────────────────────────

  N("app:lector", "app", "Lector", {
    summary: "Self-hosted language reader. Start here. Walk into a domain, then a flow, then a file or function.",
  });

  N("layer:ui", "layer", "UI", { summary: "React pages and components in src/app and src/components." });
  N("layer:client", "layer", "Client helpers", { summary: "src/lib. Most persistence goes through data-layer.ts." });
  N("layer:routes", "layer", "Hono routes", { summary: "api/src/routes. Mount table is registry.ts." });
  N("layer:lib", "layer", "API lib", { summary: "api/src/lib. Dictionary, LLM, parsers, workers." });
  N("layer:db", "layer", "SQLite", { summary: "api/src/db.ts. User data in lector.db. Pack dict files are separate." });
  N("layer:packs", "layer", "Language packs", { summary: "languages/registry.ts. Client and API both import this file." });

  // ── Domains ───────────────────────────────────────────────────────────────

  N("domain:library", "domain", "Library", {
    summary: "Collections, groups, lessons, and import.",
    md: "library.md",
  });
  N("domain:translation", "domain", "Translation", {
    summary: "Word tap, gloss stream, In-context action, and phrase selection.",
    md: "translation.md",
  });
  N("domain:vocabulary", "domain", "Vocabulary", {
    summary: "Saved entries, word states, and the known-word map.",
    md: "vocabulary.md",
  });
  N("domain:practice", "domain", "Practice", {
    summary: "Cloze, dictation, and spaced repetition.",
    md: "practice.md",
  });
  N("domain:journal", "domain", "Journal", {
    summary: "Learner text in the target language, then tutor correction.",
    md: "journal.md",
  });
  N("domain:tutor", "domain", "Tutor", {
    summary: "Chat widget and cloze Explain. Not a dictionary gloss.",
    md: "tutor.md",
  });
  N("domain:listen", "domain", "Listen", {
    summary: "Speech, podcast audio, and YouTube captions.",
    md: "listen.md",
  });
  N("domain:anki", "domain", "Anki", {
    summary: "Card push and review sync. AnkiConnect or the Lector Sync add-on.",
    md: "anki.md",
  });
  N("domain:onboarding", "domain", "Onboarding", {
    summary: "Onboarding is the product name for first-run setup.",
    md: "onboarding.md",
  });
  N("domain:stats", "domain", "Stats", {
    summary: "Daily counts, streaks, and the fluency radar. Topic domains live in domains.ts.",
    md: "stats.md",
  });

  // ── Flows ─────────────────────────────────────────────────────────────────

  N("flow:load-library-item", "flow", "Load library item", {
    domain: "library",
    md: "library.md#load-library-item",
    summary: "Open the library, open a collection, open a lesson. The reader paints each word from the known-word map.",
    steps: [
      "fn:home-loadData",
      "route:collections-list",
      "fn:collection-load",
      "route:lessons-get",
      "fn:read-loadLesson",
      "fn:getKnownWordsMap",
      "file:markdown-reader",
      "file:word-cell",
    ],
  });
  N("flow:import", "flow", "Import", {
    domain: "library",
    md: "library.md#import",
    summary: "EPUB, paste, markdown, web URL, YouTube captions, or audio. Destination group is importGroupId.",
  });
  N("flow:lesson-progress", "flow", "Lesson progress", {
    domain: "library",
    md: "library.md#lesson-progress",
    summary: "Scroll writes progress. progressWriter waits 1 second between writes.",
  });
  N("flow:translate-word", "flow", "Translate word", {
    domain: "translation",
    md: "translation.md#translate-word",
    summary: "Tap a word. Drawer opens. Vocab row, then dictionary lookup, then a gloss stream on a miss.",
    steps: [
      "fn:wordcell-activate",
      "fn:reader-onWordClick",
      "fn:read-handleWordClick",
      "fn:getVocabByText",
      "fn:lookupWordRemote",
      "route:dict-lookup",
      "fn:lookupWord",
      "fn:streamWordGloss",
      "route:translate-gloss",
      "file:translation-drawer",
    ],
  });
  N("flow:in-context", "flow", "In-context translation", {
    domain: "translation",
    md: "translation.md#in-context-translation",
    summary: "Drawer In-context action. LLM sense that fits the sentence. Does not overwrite a dict gloss on save.",
    steps: [
      "file:translation-drawer",
      "fn:read-requestContextTranslation",
      "fn:translateWord",
      "route:translate-post",
    ],
  });
  N("flow:phrase-selection", "flow", "Phrase selection", {
    domain: "translation",
    md: "translation.md#phrase-selection",
    summary: "Drag across two or more words. Snaps to bounds. translatePhrase. No dictionary path.",
  });
  N("flow:enrich-nested", "flow", "Enrich and nested lookup", {
    domain: "translation",
    md: "translation.md#enrich-and-nested-lookup",
    summary: "Enrich upgrades a bare gloss. Nested lookup follows a form-of link and keeps the original sentence.",
  });
  N("flow:cache-translation", "flow", "Cache accepted translation", {
    domain: "translation",
    md: "translation.md#cache-accepted-translation",
    summary: "Known, level, or Anki stores a trusted AI gloss in cached_entries. Next tap can skip the LLM.",
  });
  N("flow:save-vocab", "flow", "Save vocab and set word state", {
    domain: "vocabulary",
    md: "vocabulary.md#save-vocab-and-set-word-state",
    summary: "No Save button. Level, Known, Ignore, key S, or Anki creates or updates vocab and knownWords.",
  });
  N("flow:vocab-list", "flow", "Vocab list", {
    domain: "vocabulary",
    md: "vocabulary.md#vocab-list",
    summary: "Filter, search, and page in memory. GET /api/vocab has no limit.",
  });
  N("flow:known-word-import", "flow", "Known-word import", {
    domain: "vocabulary",
    md: "vocabulary.md#known-word-import",
    summary: "Plain list writes knownWords only. A LingQ CSV also writes vocab.",
  });
  N("flow:practice-word", "flow", "Practice word", {
    domain: "practice",
    md: "practice.md#practice-word",
    summary: "Seed the bank, load due or new cards, grade, persistReview. Mastery 100 writes knownWords.",
    steps: [
      "fn:practice-startRoundWith",
      "route:cloze-due",
      "fn:checkAnswer",
      "fn:commitRoundReview",
      "fn:persistReview",
      "route:cloze-review",
    ],
  });
  N("flow:dictation", "flow", "Dictation", {
    domain: "practice",
    md: "practice.md#dictation",
    summary: "Same SRS persist. User types the full sentence after TTS. Pass threshold is 0.75.",
  });
  N("flow:blacklist", "flow", "Blacklist sentence", {
    domain: "practice",
    md: "practice.md#blacklist-sentence",
    summary: "Row stays in the table. Due queries exclude it.",
  });
  N("flow:journal-submit", "flow", "Submit journal for correction", {
    domain: "journal",
    md: "journal.md#submit-journal-for-correction",
    summary: "Create or update a draft, then POST /api/journal/:id/correct. LLM returns correctedBody and corrections.",
    steps: [
      "fn:journal-handleSubmit",
      "fn:createJournalEntry",
      "route:journal-create",
      "fn:submitJournalForCorrection",
      "route:journal-correct",
      "fn:correctJournalText",
    ],
  });
  N("flow:journal-draft", "flow", "Save journal draft", {
    domain: "journal",
    md: "journal.md#save-journal-draft",
    summary: "Save Draft writes the row. No LLM call. After first create, a 3 second timer also writes.",
  });
  N("flow:tutor-chat", "flow", "Tutor chat", {
    domain: "tutor",
    md: "tutor.md#tutor-chat",
    summary: "Chat widget. POST /api/chat. Free plan does not persist history.",
  });
  N("flow:cloze-explain", "flow", "Cloze Explain", {
    domain: "tutor",
    md: "tutor.md#cloze-explain",
    summary: "After a cloze Check, Explain asks for a prose breakdown. Dictation has no Explain.",
  });
  N("flow:speak-word", "flow", "Speak word", {
    domain: "listen",
    md: "listen.md#speak-word",
    summary: "tts.speak. Pack audio none, eSpeak, Google, or browser speechSynthesis.",
  });
  N("flow:listen-along", "flow", "Listen-along", {
    domain: "listen",
    md: "listen.md#listen-along",
    summary: "Podcast playback after ASR. GET segments and Range audio. Not the YouTube player.",
  });
  N("flow:youtube-captions", "flow", "YouTube captions", {
    domain: "listen",
    md: "listen.md#youtube-captions",
    summary: "Cues on lessons.segments JSON. YouTube iframe seek. Import is the Library domain.",
  });
  N("flow:anki-push", "flow", "Push to Anki", {
    domain: "anki",
    md: "anki.md#push-to-anki",
    summary: "AnkiConnect addNote from the browser, or POST /api/anki/queue for the add-on.",
  });
  N("flow:anki-sync", "flow", "Sync Anki reviews", {
    domain: "anki",
    md: "anki.md#sync-anki-reviews",
    summary: "Upgrade-only map from Anki card type to word state. Heatmap day counts are a second writer.",
  });
  N("flow:language-setup", "flow", "Language setup", {
    domain: "onboarding",
    md: "onboarding.md#language-setup",
    summary: "SetupGuard, seed starter, guided lesson, three cloze cards, complete Onboarding.",
  });
  N("flow:daily-stats", "flow", "Daily stats", {
    domain: "stats",
    md: "stats.md#daily-stats",
    summary: "PUT /api/stats/today from the client. Dictionary and translate routes stamp sessionStartedAt.",
  });
  N("flow:fluency-radar", "flow", "Fluency radar", {
    domain: "stats",
    md: "stats.md#fluency-radar",
    summary: "Background classify-worker tags knownWords.domain. Not on the tap path.",
  });

  // ── Shared files ──────────────────────────────────────────────────────────

  N("file:home-page", "file", "Home page", { path: "src/app/(index)/page.tsx", domain: "library" });
  N("file:collection-page", "file", "Collection page", { path: "src/app/collection/[id]/page.tsx", domain: "library" });
  N("file:read-page", "file", "Read page", { path: "src/app/read/[bookId]/page.tsx", domain: "translation" });
  N("file:markdown-reader", "file", "MarkdownReader", { path: "src/components/MarkdownReader/index.tsx", domain: "library" });
  N("file:reader-article", "file", "ReaderArticle", { path: "src/components/MarkdownReader/ReaderArticle.tsx", domain: "library" });
  N("file:transcript-reader", "file", "TranscriptReader", { path: "src/components/MarkdownReader/TranscriptReader.tsx", domain: "listen" });
  N("file:word-cell", "file", "WordCell", { path: "src/components/WordCell/index.tsx", domain: "library" });
  N("file:translation-drawer", "file", "TranslationDrawer", { path: "src/components/TranslationDrawer/index.tsx", domain: "translation" });
  N("file:data-layer", "file", "data-layer.ts", { path: "src/lib/data-layer.ts", domain: "library" });
  N("file:api-base", "file", "api-base.ts", { path: "src/lib/api-base.ts" });
  N("file:dictionary-client", "file", "dictionary-client.ts", { path: "src/lib/dictionary-client.ts", domain: "translation" });
  N("file:claude", "file", "claude.ts", { path: "src/lib/claude.ts", domain: "translation" });
  N("file:languages-client", "file", "languages.ts (client)", { path: "src/lib/languages.ts" });
  N("file:pack-registry", "file", "languages/registry.ts", { path: "languages/registry.ts" });
  N("file:words", "file", "words.ts", { path: "src/lib/words.ts" });
  N("file:tts", "file", "tts.ts", { path: "src/lib/tts.ts", domain: "listen" });
  N("file:optimistic-state", "file", "optimistic-word-state.ts", { path: "src/components/MarkdownReader/optimistic-word-state.ts", domain: "vocabulary" });
  N("file:practice-page", "file", "Practice page", { path: "src/app/practice/page.tsx", domain: "practice" });
  N("file:use-cloze-round", "file", "use-cloze-round.ts", { path: "src/app/practice/use-cloze-round.ts", domain: "practice" });
  N("file:persist-review", "file", "persist-review.ts", { path: "src/app/practice/persist-review.ts", domain: "practice" });
  N("file:practice-utils", "file", "practice/utils.ts", { path: "src/app/practice/utils.ts", domain: "practice" });
  N("file:journal-page", "file", "Journal page", { path: "src/app/journal/page.tsx", domain: "journal" });
  N("file:correction-view", "file", "CorrectionView", { path: "src/app/journal/components/CorrectionView.tsx", domain: "journal" });
  N("file:chat-widget", "file", "ChatWidget", { path: "src/components/ChatWidget/index.tsx", domain: "tutor" });
  N("file:cloze-feedback", "file", "ClozeFeedback", { path: "src/components/ClozeFeedback/index.tsx", domain: "tutor" });
  N("file:vocab-page", "file", "Vocab page", { path: "src/app/vocab/page.tsx", domain: "vocabulary" });
  N("file:known-words-import", "file", "KnownWordsImport", { path: "src/app/settings/components/KnownWordsImport/index.tsx", domain: "vocabulary" });
  N("file:listen-along", "file", "ListenAlong", { path: "src/components/ListenAlong/index.tsx", domain: "listen" });
  N("file:youtube-player", "file", "YouTubePlayer", { path: "src/components/YouTubePlayer/index.tsx", domain: "listen" });
  N("file:anki-client", "file", "anki.ts", { path: "src/lib/anki.ts", domain: "anki" });
  N("file:anki-queue", "file", "anki-queue.ts", { path: "src/lib/anki-queue.ts", domain: "anki" });
  N("file:anki-transport", "file", "anki-transport.ts", { path: "src/lib/anki-transport.ts", domain: "anki" });
  N("file:setup-page", "file", "Setup page", { path: "src/app/setup/page.tsx", domain: "onboarding" });
  N("file:setup-guard", "file", "SetupGuard", { path: "src/components/SetupGuard/index.tsx", domain: "onboarding" });
  N("file:onboarding-client", "file", "onboarding.ts", { path: "src/lib/onboarding.ts", domain: "onboarding" });
  N("file:stats-page", "file", "Stats page", { path: "src/app/stats/page.tsx", domain: "stats" });
  N("file:web-import", "file", "WebImportModal", { path: "src/components/WebImportModal/index.tsx", domain: "library" });
  N("file:youtube-import", "file", "YouTubeImportModal", { path: "src/components/YouTubeImportModal/index.tsx", domain: "library" });
  N("file:paste-import", "file", "PasteImportModal", { path: "src/components/PasteImportModal/index.tsx", domain: "library" });
  N("file:definition-links", "file", "definition-links.ts", { path: "src/lib/definition-links.ts", domain: "translation" });

  N("file:registry", "file", "registry.ts", { path: "api/src/routes/registry.ts" });
  N("file:route-collections", "file", "collections.ts", { path: "api/src/routes/collections.ts", domain: "library" });
  N("file:route-lessons", "file", "lessons.ts", { path: "api/src/routes/lessons.ts", domain: "library" });
  N("file:route-import", "file", "import.ts", { path: "api/src/routes/import.ts", domain: "library" });
  N("file:route-youtube", "file", "youtube-import.ts", { path: "api/src/routes/youtube-import.ts", domain: "library" });
  N("file:route-extract", "file", "extract-url.ts", { path: "api/src/routes/extract-url.ts", domain: "library" });
  N("file:route-dictionary", "file", "dictionary.ts", { path: "api/src/routes/dictionary.ts", domain: "translation" });
  N("file:route-translate", "file", "translate.ts", { path: "api/src/routes/translate.ts", domain: "translation" });
  N("file:route-vocab", "file", "vocab.ts", { path: "api/src/routes/vocab.ts", domain: "vocabulary" });
  N("file:route-known-words", "file", "known-words.ts", { path: "api/src/routes/known-words.ts", domain: "vocabulary" });
  N("file:route-cloze", "file", "cloze.ts", { path: "api/src/routes/cloze.ts", domain: "practice" });
  N("file:route-journal", "file", "journal.ts", { path: "api/src/routes/journal.ts", domain: "journal" });
  N("file:route-chat", "file", "chat.ts", { path: "api/src/routes/chat.ts", domain: "tutor" });
  N("file:route-explain", "file", "explain.ts", { path: "api/src/routes/explain.ts", domain: "tutor" });
  N("file:route-tts", "file", "tts.ts", { path: "api/src/routes/tts.ts", domain: "listen" });
  N("file:route-anki", "file", "anki.ts (API)", { path: "api/src/routes/anki.ts", domain: "anki" });
  N("file:route-starter", "file", "starter.ts", { path: "api/src/routes/starter.ts", domain: "onboarding" });
  N("file:route-onboarding", "file", "onboarding.ts (API)", { path: "api/src/routes/onboarding.ts", domain: "onboarding" });
  N("file:route-stats", "file", "stats.ts", { path: "api/src/routes/stats.ts", domain: "stats" });
  N("file:db", "file", "db.ts", { path: "api/src/db.ts" });
  N("file:dictionary-db", "file", "dictionary-db.ts", { path: "api/src/lib/dictionary-db.ts", domain: "translation" });
  N("file:translate-prompts", "file", "translate-prompts.ts", { path: "api/src/lib/translate-prompts.ts", domain: "translation" });
  N("file:llm", "file", "llm/index.ts", { path: "api/src/lib/llm/index.ts" });
  N("file:entitlements", "file", "entitlements.ts", { path: "api/src/lib/entitlements.ts" });
  N("file:journal-correct", "file", "journal-correct.ts", { path: "api/src/lib/journal-correct.ts", domain: "journal" });
  N("file:epub-parser", "file", "epub-parser.ts", { path: "api/src/lib/epub-parser.ts", domain: "library" });
  N("file:html-to-markdown", "file", "html-to-markdown.ts", { path: "api/src/lib/html-to-markdown.ts", domain: "library" });
  N("file:transcribe-worker", "file", "transcribe-worker.ts", { path: "api/src/lib/transcribe-worker.ts", domain: "listen" });
  N("file:classify-worker", "file", "classify-worker.ts", { path: "api/src/lib/classify-worker.ts", domain: "stats" });
  N("file:word-classifier", "file", "word-classifier.ts", { path: "api/src/lib/word-classifier.ts", domain: "stats" });
  N("file:domains-lib", "file", "domains.ts", { path: "api/src/lib/domains.ts", domain: "stats" });
  N("file:study-session", "file", "study-session.ts", { path: "api/src/lib/study-session.ts", domain: "stats" });
  N("file:active-language", "file", "active-language.ts", { path: "api/src/lib/active-language.ts" });
  N("file:starter-content", "file", "starter-content.ts", { path: "api/src/lib/starter-content.ts", domain: "onboarding" });
  N("file:anki-addon", "file", "anki-addon sync.py", { path: "anki-addon/lector/sync.py", domain: "anki" });

  // ── Functions ─────────────────────────────────────────────────────────────

  N("fn:home-loadData", "fn", "Home.loadData", { path: "src/app/(index)/page.tsx" });
  N("fn:getAllCollections", "fn", "getAllCollections", { path: "src/lib/data-layer.ts" });
  N("fn:getCollection", "fn", "getCollection", { path: "src/lib/data-layer.ts" });
  N("fn:getLessonsForCollection", "fn", "getLessonsForCollection", { path: "src/lib/data-layer.ts" });
  N("fn:getLesson", "fn", "getLesson", { path: "src/lib/data-layer.ts" });
  N("fn:getKnownWordsMap", "fn", "getKnownWordsMap", { path: "src/lib/data-layer.ts" });
  N("fn:collection-load", "fn", "CollectionPage.load", { path: "src/app/collection/[id]/page.tsx" });
  N("fn:read-loadLesson", "fn", "ReadPage.loadLesson", { path: "src/app/read/[bookId]/page.tsx" });
  N("fn:wordcell-activate", "fn", "WordCell.onActivate", { path: "src/components/WordCell/index.tsx" });
  N("fn:reader-onWordClick", "fn", "ReaderBlock.onWordClick", { path: "src/components/MarkdownReader/ReaderArticle.tsx" });
  N("fn:findSentence", "fn", "findSentence", { path: "src/components/MarkdownReader/ReaderArticle.tsx" });
  N("fn:read-handleWordClick", "fn", "ReadPage.handleWordClick", { path: "src/app/read/[bookId]/page.tsx" });
  N("fn:practice-handleWordClick", "fn", "PracticePage.handleWordClick", { path: "src/app/practice/page.tsx" });
  N("fn:getVocabByText", "fn", "getVocabByText", { path: "src/lib/data-layer.ts" });
  N("fn:lookupWordRemote", "fn", "lookupWordRemote", { path: "src/lib/dictionary-client.ts" });
  N("fn:streamWordGloss", "fn", "streamWordGloss", { path: "src/lib/claude.ts" });
  N("fn:translateWord", "fn", "translateWord", { path: "src/lib/claude.ts" });
  N("fn:translatePhrase", "fn", "translatePhrase", { path: "src/lib/claude.ts" });
  N("fn:enrichWord", "fn", "enrichWord", { path: "src/lib/claude.ts" });
  N("fn:translateGloss", "fn", "translateGloss", { path: "src/lib/claude.ts" });
  N("fn:lookupWord", "fn", "lookupWord", { path: "api/src/lib/dictionary-db.ts" });
  N("fn:resolveWord", "fn", "resolveWord", { path: "api/src/lib/dictionary-db.ts" });
  N("fn:cacheAcceptedEntry", "fn", "cacheAcceptedEntry", { path: "api/src/lib/dictionary-db.ts" });
  N("fn:cacheAcceptedTranslation", "fn", "cacheAcceptedTranslation", { path: "src/lib/dictionary-client.ts" });
  N("fn:read-requestContextTranslation", "fn", "requestContextTranslation", { path: "src/app/read/[bookId]/page.tsx" });
  N("fn:read-handleNestedLookup", "fn", "handleNestedLookup", { path: "src/app/read/[bookId]/page.tsx" });
  N("fn:handleMouseUp", "fn", "MarkdownReader.handleMouseUp", { path: "src/components/MarkdownReader/index.tsx" });
  N("fn:snapToWordBoundaries", "fn", "snapToWordBoundaries", { path: "src/components/MarkdownReader/index.tsx" });
  N("fn:findNestedWordRef", "fn", "findNestedWordRef", { path: "src/lib/definition-links.ts" });
  N("fn:applyReaderWordState", "fn", "applyReaderWordState", { path: "src/app/read/[bookId]/page.tsx" });
  N("fn:patchWordState", "fn", "patchWordState", { path: "src/components/MarkdownReader/optimistic-word-state.ts" });
  N("fn:saveVocab", "fn", "saveVocab", { path: "src/lib/data-layer.ts" });
  N("fn:updateVocabState", "fn", "updateVocabState", { path: "src/lib/data-layer.ts" });
  N("fn:updateLessonProgress", "fn", "updateLessonProgress", { path: "src/lib/data-layer.ts" });
  N("fn:importEpub", "fn", "importEpub", { path: "src/lib/data-layer.ts" });
  N("fn:createStandaloneLesson", "fn", "createStandaloneLesson", { path: "src/lib/data-layer.ts" });
  N("fn:parseEpub", "fn", "parseEpub", { path: "api/src/lib/epub-parser.ts" });
  N("fn:buildSegmentWords", "fn", "buildSegmentWords", { path: "api/src/lib/html-to-markdown.ts" });
  N("fn:practice-startRoundWith", "fn", "startRoundWith", { path: "src/app/practice/page.tsx" });
  N("fn:seedSentenceBank", "fn", "seedSentenceBank", { path: "src/lib/data-layer.ts" });
  N("fn:checkAnswer", "fn", "checkAnswer", { path: "src/app/practice/utils.ts" });
  N("fn:calculateNextReview", "fn", "calculateNextReview", { path: "src/app/practice/utils.ts" });
  N("fn:commitRoundReview", "fn", "commitRoundReview", { path: "src/app/practice/use-cloze-round.ts" });
  N("fn:persistReview", "fn", "persistReview", { path: "src/app/practice/persist-review.ts" });
  N("fn:updateClozeAfterReview", "fn", "updateClozeAfterReview", { path: "src/lib/data-layer.ts" });
  N("fn:journal-handleSubmit", "fn", "JournalPage.handleSubmit", { path: "src/app/journal/page.tsx" });
  N("fn:createJournalEntry", "fn", "createJournalEntry", { path: "src/lib/data-layer.ts" });
  N("fn:updateJournalDraft", "fn", "updateJournalDraft", { path: "src/lib/data-layer.ts" });
  N("fn:submitJournalForCorrection", "fn", "submitJournalForCorrection", { path: "src/lib/data-layer.ts" });
  N("fn:correctJournalText", "fn", "correctJournalText", { path: "api/src/lib/journal-correct.ts" });
  N("fn:getProvider", "fn", "getProvider", { path: "api/src/lib/llm/index.ts" });
  N("fn:completeJson", "fn", "completeJson", { path: "api/src/lib/llm/complete-json.ts" });
  N("fn:sendMessage", "fn", "ChatWidget.sendMessage", { path: "src/components/ChatWidget/index.tsx" });
  N("fn:handleExplain", "fn", "ClozeFeedback.handleExplain", { path: "src/components/ClozeFeedback/index.tsx" });
  N("fn:speak", "fn", "speak", { path: "src/lib/tts.ts" });
  N("fn:queueForAnki", "fn", "queueForAnki", { path: "src/lib/anki-queue.ts" });
  N("fn:addWordCard", "fn", "addWordCard", { path: "src/lib/anki.ts" });
  N("fn:useAnkiTransport", "fn", "useAnkiTransport", { path: "src/lib/anki-transport.ts" });
  N("fn:syncWordStates", "fn", "syncWordStates", { path: "src/lib/anki.ts" });
  N("fn:seedStarterContent", "fn", "seedStarterContent", { path: "src/lib/data-layer.ts" });
  N("fn:startOnboarding", "fn", "startOnboarding", { path: "src/lib/onboarding.ts" });
  N("fn:incrementDailyStat", "fn", "incrementDailyStat", { path: "src/lib/data-layer.ts" });
  N("fn:recordStudySessionPing", "fn", "recordStudySessionPing", { path: "api/src/lib/study-session.ts" });
  N("fn:resolveLanguage", "fn", "resolveLanguage", { path: "api/src/lib/active-language.ts" });
  N("fn:apiFetch", "fn", "apiFetch", { path: "src/lib/api-base.ts" });
  N("fn:buildGlossPrompt", "fn", "buildGlossPrompt", { path: "api/src/lib/translate-prompts.ts" });
  N("fn:buildWordEntryPrompt", "fn", "buildWordEntryPrompt", { path: "api/src/lib/translate-prompts.ts" });
  N("fn:foldWord", "fn", "foldWord", { path: "languages/registry.ts" });
  N("fn:deriveDomainFluency", "fn", "deriveDomainFluency", { path: "api/src/lib/domains.ts" });

  // ── Routes ────────────────────────────────────────────────────────────────

  N("route:collections-list", "route", "GET /api/collections", { path: "api/src/routes/collections.ts" });
  N("route:collections-get", "route", "GET /api/collections/:id", { path: "api/src/routes/collections.ts" });
  N("route:collection-lessons", "route", "GET /api/collections/:id/lessons", { path: "api/src/routes/collections.ts" });
  N("route:lessons-get", "route", "GET /api/lessons/:id", { path: "api/src/routes/lessons.ts" });
  N("route:lessons-progress", "route", "PUT /api/lessons/:id/progress", { path: "api/src/routes/lessons.ts" });
  N("route:lessons-segments", "route", "GET /api/lessons/:id/segments", { path: "api/src/routes/lessons.ts" });
  N("route:lessons-audio", "route", "GET /api/lessons/:id/audio", { path: "api/src/routes/lessons.ts" });
  N("route:known-words-get", "route", "GET /api/known-words", { path: "api/src/routes/known-words.ts" });
  N("route:known-words-post", "route", "POST /api/known-words", { path: "api/src/routes/known-words.ts" });
  N("route:import-epub", "route", "POST /api/import/epub", { path: "api/src/routes/import.ts" });
  N("route:import-audio", "route", "POST /api/import/audio", { path: "api/src/routes/import.ts" });
  N("route:extract-url", "route", "POST /api/extract-url", { path: "api/src/routes/extract-url.ts" });
  N("route:youtube-resolve", "route", "POST /api/import/youtube/resolve", { path: "api/src/routes/youtube-import.ts" });
  N("route:youtube-import", "route", "POST /api/import/youtube", { path: "api/src/routes/youtube-import.ts" });
  N("route:dict-lookup", "route", "GET /api/dictionary/lookup", { path: "api/src/routes/dictionary.ts" });
  N("route:dict-cache", "route", "POST /api/dictionary/cache", { path: "api/src/routes/dictionary.ts" });
  N("route:translate-gloss", "route", "POST /api/translate/gloss", { path: "api/src/routes/translate.ts" });
  N("route:translate-enrich", "route", "POST /api/translate/enrich", { path: "api/src/routes/translate.ts" });
  N("route:translate-post", "route", "POST /api/translate", { path: "api/src/routes/translate.ts" });
  N("route:vocab-get", "route", "GET /api/vocab", { path: "api/src/routes/vocab.ts" });
  N("route:vocab-post", "route", "POST /api/vocab", { path: "api/src/routes/vocab.ts" });
  N("route:vocab-put", "route", "PUT /api/vocab/:id", { path: "api/src/routes/vocab.ts" });
  N("route:cloze-seed", "route", "POST /api/cloze/seed", { path: "api/src/routes/cloze.ts" });
  N("route:cloze-due", "route", "GET /api/cloze/due", { path: "api/src/routes/cloze.ts" });
  N("route:cloze-review", "route", "POST /api/cloze/:id/review", { path: "api/src/routes/cloze.ts" });
  N("route:cloze-put", "route", "PUT /api/cloze/:id", { path: "api/src/routes/cloze.ts" });
  N("route:journal-list", "route", "GET /api/journal", { path: "api/src/routes/journal.ts" });
  N("route:journal-create", "route", "POST /api/journal", { path: "api/src/routes/journal.ts" });
  N("route:journal-put", "route", "PUT /api/journal/:id", { path: "api/src/routes/journal.ts" });
  N("route:journal-correct", "route", "POST /api/journal/:id/correct", { path: "api/src/routes/journal.ts" });
  N("route:chat-post", "route", "POST /api/chat", { path: "api/src/routes/chat.ts" });
  N("route:explain-post", "route", "POST /api/explain", { path: "api/src/routes/explain.ts" });
  N("route:tts-post", "route", "POST /api/tts", { path: "api/src/routes/tts.ts" });
  N("route:anki-queue", "route", "POST /api/anki/queue", { path: "api/src/routes/anki.ts" });
  N("route:anki-pending", "route", "GET /api/anki/pending", { path: "api/src/routes/anki.ts" });
  N("route:anki-ack", "route", "POST /api/anki/ack", { path: "api/src/routes/anki.ts" });
  N("route:anki-reviews", "route", "POST /api/anki/reviews", { path: "api/src/routes/anki.ts" });
  N("route:starter-seed", "route", "POST /api/starter/seed", { path: "api/src/routes/starter.ts" });
  N("route:onboarding-start", "route", "POST /api/onboarding/start", { path: "api/src/routes/onboarding.ts" });
  N("route:stats-today", "route", "PUT /api/stats/today", { path: "api/src/routes/stats.ts" });
  N("route:stats-fluency", "route", "GET /api/stats/fluency", { path: "api/src/routes/stats.ts" });

  // ── Tables ────────────────────────────────────────────────────────────────

  N("table:collections", "table", "collections", { path: "api/src/db.ts" });
  N("table:lessons", "table", "lessons", { path: "api/src/db.ts" });
  N("table:knownWords", "table", "knownWords", { path: "api/src/db.ts" });
  N("table:vocab", "table", "vocab", { path: "api/src/db.ts" });
  N("table:clozeSentences", "table", "clozeSentences", { path: "api/src/db.ts" });
  N("table:journal_entries", "table", "journal_entries", { path: "api/src/db.ts" });
  N("table:chat_messages", "table", "chat_messages", { path: "api/src/db.ts" });
  N("table:cached_entries", "table", "cached_entries", { path: "api/src/db.ts" });
  N("table:dailyStats", "table", "dailyStats", { path: "api/src/db.ts" });
  N("table:anki_pending", "table", "anki_pending", { path: "api/src/db.ts" });
  N("table:transcript_segments", "table", "transcript_segments", { path: "api/src/db.ts" });
  N("table:onboarding_progress", "table", "onboarding_progress", { path: "api/src/db.ts" });
  N("table:usage_counters", "table", "usage_counters", { path: "api/src/db.ts" });
  N("table:dict-pack", "table", "dictionary-{lang}.db", { path: "data/dictionary-{lang}.db" });

  // ── Edges: app, layers, domains ───────────────────────────────────────────

  edge("app:lector", "layer:ui", "contains");
  edge("app:lector", "layer:client", "contains");
  edge("app:lector", "layer:routes", "contains");
  edge("app:lector", "layer:lib", "contains");
  edge("app:lector", "layer:db", "contains");
  edge("app:lector", "layer:packs", "contains");
  chain(["layer:ui", "layer:client", "layer:routes", "layer:lib", "layer:db"], "then");
  edge("layer:client", "layer:packs", "uses");
  edge("layer:lib", "layer:packs", "uses");
  edge("layer:routes", "file:registry", "uses");
  edge("layer:db", "file:db", "uses");
  edge("layer:packs", "file:pack-registry", "uses");
  edge("layer:client", "file:data-layer", "uses");
  edge("layer:client", "file:api-base", "uses");
  edge("fn:apiFetch", "file:api-base", "in");

  [
    "library",
    "translation",
    "vocabulary",
    "practice",
    "journal",
    "tutor",
    "listen",
    "anki",
    "onboarding",
    "stats",
  ].forEach(function (d) {
    edge("app:lector", "domain:" + d, "contains");
  });

  edge("domain:library", "domain:translation", "then");
  edge("domain:translation", "domain:vocabulary", "then");
  edge("domain:vocabulary", "domain:practice", "then");
  edge("domain:vocabulary", "domain:anki", "then");
  edge("domain:library", "domain:listen", "then");
  edge("domain:practice", "domain:tutor", "then");
  edge("domain:journal", "domain:tutor", "then");
  edge("domain:onboarding", "domain:library", "then");
  edge("domain:onboarding", "domain:practice", "then");
  edge("domain:vocabulary", "domain:stats", "then");
  edge("domain:practice", "domain:stats", "then");

  function domainFlows(domain, flowIds) {
    flowIds.forEach(function (id) {
      edge("domain:" + domain, id, "contains");
    });
  }

  domainFlows("library", ["flow:load-library-item", "flow:import", "flow:lesson-progress"]);
  domainFlows("translation", [
    "flow:translate-word",
    "flow:in-context",
    "flow:phrase-selection",
    "flow:enrich-nested",
    "flow:cache-translation",
  ]);
  domainFlows("vocabulary", ["flow:save-vocab", "flow:vocab-list", "flow:known-word-import"]);
  domainFlows("practice", ["flow:practice-word", "flow:dictation", "flow:blacklist"]);
  domainFlows("journal", ["flow:journal-submit", "flow:journal-draft"]);
  domainFlows("tutor", ["flow:tutor-chat", "flow:cloze-explain"]);
  domainFlows("listen", ["flow:speak-word", "flow:listen-along", "flow:youtube-captions"]);
  domainFlows("anki", ["flow:anki-push", "flow:anki-sync"]);
  domainFlows("onboarding", ["flow:language-setup"]);
  domainFlows("stats", ["flow:daily-stats", "flow:fluency-radar"]);

  // Cross-flow walks
  edge("flow:load-library-item", "flow:translate-word", "then");
  edge("flow:translate-word", "flow:in-context", "then");
  edge("flow:translate-word", "flow:save-vocab", "then");
  edge("flow:translate-word", "flow:speak-word", "then");
  edge("flow:save-vocab", "flow:practice-word", "then");
  edge("flow:save-vocab", "flow:anki-push", "then");
  edge("flow:practice-word", "flow:cloze-explain", "then");
  edge("flow:import", "flow:load-library-item", "then");
  edge("flow:import", "flow:listen-along", "then");
  edge("flow:import", "flow:youtube-captions", "then");
  edge("flow:language-setup", "flow:load-library-item", "then");
  edge("flow:language-setup", "flow:practice-word", "then");
  edge("flow:cache-translation", "flow:translate-word", "then");
  edge("flow:phrase-selection", "flow:save-vocab", "then");
  edge("flow:journal-draft", "flow:journal-submit", "then");

  // ── Load library item ─────────────────────────────────────────────────────

  edge("flow:load-library-item", "fn:home-loadData", "starts");
  edge("fn:home-loadData", "file:home-page", "in");
  edge("fn:home-loadData", "fn:getAllCollections", "calls");
  edge("fn:getAllCollections", "file:data-layer", "in");
  edge("fn:getAllCollections", "fn:apiFetch", "calls");
  edge("fn:getAllCollections", "route:collections-list", "http");
  edge("route:collections-list", "file:route-collections", "in");
  edge("route:collections-list", "table:collections", "reads");
  edge("route:collections-list", "table:lessons", "reads");
  edge("flow:load-library-item", "fn:collection-load", "then");
  edge("fn:collection-load", "file:collection-page", "in");
  edge("fn:collection-load", "fn:getCollection", "calls");
  edge("fn:collection-load", "fn:getLessonsForCollection", "calls");
  edge("fn:getCollection", "route:collections-get", "http");
  edge("fn:getLessonsForCollection", "route:collection-lessons", "http");
  edge("fn:getCollection", "file:data-layer", "in");
  edge("fn:getLessonsForCollection", "file:data-layer", "in");
  edge("flow:load-library-item", "fn:read-loadLesson", "then");
  edge("fn:read-loadLesson", "file:read-page", "in");
  edge("fn:read-loadLesson", "fn:getLesson", "calls");
  edge("fn:read-loadLesson", "fn:getKnownWordsMap", "calls");
  edge("fn:getLesson", "file:data-layer", "in");
  edge("fn:getLesson", "route:lessons-get", "http");
  edge("route:lessons-get", "file:route-lessons", "in");
  edge("route:lessons-get", "table:lessons", "reads");
  edge("route:lessons-get", "fn:resolveLanguage", "calls");
  edge("fn:getKnownWordsMap", "file:data-layer", "in");
  edge("fn:getKnownWordsMap", "route:known-words-get", "http");
  edge("route:known-words-get", "file:route-known-words", "in");
  edge("route:known-words-get", "table:knownWords", "reads");
  edge("route:known-words-post", "file:route-known-words", "in");
  edge("fn:read-loadLesson", "file:markdown-reader", "opens");
  edge("file:markdown-reader", "file:reader-article", "uses");
  edge("file:markdown-reader", "file:word-cell", "uses");
  edge("file:markdown-reader", "file:transcript-reader", "uses");
  edge("fn:resolveLanguage", "file:active-language", "in");

  edge("flow:lesson-progress", "fn:updateLessonProgress", "starts");
  edge("fn:updateLessonProgress", "file:data-layer", "in");
  edge("fn:updateLessonProgress", "route:lessons-progress", "http");
  edge("route:lessons-progress", "table:lessons", "writes");
  edge("route:lessons-progress", "table:collections", "writes");
  edge("file:markdown-reader", "fn:updateLessonProgress", "calls");

  // ── Import ────────────────────────────────────────────────────────────────

  edge("flow:import", "file:home-page", "starts");
  edge("flow:import", "fn:importEpub", "calls");
  edge("fn:importEpub", "file:data-layer", "in");
  edge("fn:importEpub", "route:import-epub", "http");
  edge("route:import-epub", "file:route-import", "in");
  edge("route:import-epub", "fn:parseEpub", "calls");
  edge("fn:parseEpub", "file:epub-parser", "in");
  edge("route:import-epub", "fn:buildSegmentWords", "calls");
  edge("fn:buildSegmentWords", "file:html-to-markdown", "in");
  edge("route:import-epub", "table:collections", "writes");
  edge("route:import-epub", "table:lessons", "writes");
  edge("flow:import", "fn:createStandaloneLesson", "calls");
  edge("fn:createStandaloneLesson", "file:data-layer", "in");
  edge("file:paste-import", "fn:createStandaloneLesson", "calls");
  edge("file:web-import", "route:extract-url", "http");
  edge("route:extract-url", "file:route-extract", "in");
  edge("file:web-import", "fn:createStandaloneLesson", "calls");
  edge("file:youtube-import", "route:youtube-resolve", "http");
  edge("file:youtube-import", "route:youtube-import", "http");
  edge("route:youtube-import", "file:route-youtube", "in");
  edge("route:youtube-import", "table:lessons", "writes");
  edge("flow:import", "route:import-audio", "http");
  edge("route:import-audio", "file:transcribe-worker", "then");
  edge("file:transcribe-worker", "table:transcript_segments", "writes");
  edge("file:home-page", "file:web-import", "opens");
  edge("file:home-page", "file:youtube-import", "opens");
  edge("file:home-page", "file:paste-import", "opens");

  // ── Translate word ────────────────────────────────────────────────────────

  edge("flow:translate-word", "fn:wordcell-activate", "starts");
  edge("fn:wordcell-activate", "file:word-cell", "in");
  edge("fn:wordcell-activate", "fn:reader-onWordClick", "then");
  edge("fn:reader-onWordClick", "file:reader-article", "in");
  edge("fn:reader-onWordClick", "fn:findSentence", "calls");
  edge("fn:findSentence", "file:reader-article", "in");
  edge("fn:reader-onWordClick", "fn:read-handleWordClick", "then");
  edge("fn:read-handleWordClick", "file:read-page", "in");
  edge("fn:read-handleWordClick", "fn:speak", "calls");
  edge("fn:read-handleWordClick", "fn:incrementDailyStat", "calls");
  edge("fn:read-handleWordClick", "fn:getVocabByText", "calls");
  edge("fn:read-handleWordClick", "fn:lookupWordRemote", "calls");
  edge("fn:getVocabByText", "file:data-layer", "in");
  edge("fn:getVocabByText", "route:vocab-get", "http");
  edge("route:vocab-get", "table:vocab", "reads");
  edge("fn:lookupWordRemote", "file:dictionary-client", "in");
  edge("fn:lookupWordRemote", "fn:foldWord", "calls");
  edge("fn:lookupWordRemote", "route:dict-lookup", "http");
  edge("route:dict-lookup", "file:route-dictionary", "in");
  edge("route:dict-lookup", "fn:lookupWord", "calls");
  edge("route:dict-lookup", "fn:recordStudySessionPing", "calls");
  edge("fn:lookupWord", "file:dictionary-db", "in");
  edge("fn:lookupWord", "fn:resolveWord", "calls");
  edge("fn:resolveWord", "file:dictionary-db", "in");
  edge("fn:resolveWord", "table:dict-pack", "reads");
  edge("fn:resolveWord", "table:cached_entries", "reads");
  edge("fn:read-handleWordClick", "fn:streamWordGloss", "calls");
  edge("fn:streamWordGloss", "file:claude", "in");
  edge("fn:streamWordGloss", "route:translate-gloss", "http");
  edge("route:translate-gloss", "file:route-translate", "in");
  edge("route:translate-gloss", "fn:buildGlossPrompt", "calls");
  edge("route:translate-gloss", "fn:getProvider", "calls");
  edge("route:translate-gloss", "file:entitlements", "meters");
  edge("fn:buildGlossPrompt", "file:translate-prompts", "in");
  edge("fn:getProvider", "file:llm", "in");
  edge("fn:read-handleWordClick", "file:translation-drawer", "opens");
  edge("file:translation-drawer", "flow:in-context", "opens");
  edge("file:translation-drawer", "flow:save-vocab", "opens");
  edge("fn:practice-handleWordClick", "file:practice-page", "in");
  edge("fn:practice-handleWordClick", "fn:lookupWordRemote", "calls");
  edge("fn:practice-handleWordClick", "fn:translateGloss", "calls");
  edge("fn:translateGloss", "file:claude", "in");
  edge("fn:translateGloss", "fn:streamWordGloss", "calls");
  edge("fn:foldWord", "file:pack-registry", "in");
  edge("file:languages-client", "file:pack-registry", "uses");
  edge("layer:client", "file:languages-client", "uses");
  edge("fn:incrementDailyStat", "file:data-layer", "in");
  edge("fn:incrementDailyStat", "route:stats-today", "http");
  edge("fn:recordStudySessionPing", "file:study-session", "in");
  edge("fn:recordStudySessionPing", "table:dailyStats", "writes");
  edge("flow:translate-word", "flow:practice-word", "uses");

  // ── In-context and phrase ─────────────────────────────────────────────────

  edge("flow:in-context", "file:translation-drawer", "starts");
  edge("flow:in-context", "fn:read-requestContextTranslation", "calls");
  edge("fn:read-requestContextTranslation", "file:read-page", "in");
  edge("fn:read-requestContextTranslation", "fn:translateWord", "calls");
  edge("fn:translateWord", "file:claude", "in");
  edge("fn:translateWord", "route:translate-post", "http");
  edge("route:translate-post", "file:route-translate", "in");
  edge("route:translate-post", "fn:buildWordEntryPrompt", "calls");
  edge("route:translate-post", "fn:getProvider", "calls");
  edge("route:translate-post", "file:entitlements", "meters");
  edge("fn:buildWordEntryPrompt", "file:translate-prompts", "in");
  edge("file:words", "flow:in-context", "uses");

  edge("flow:phrase-selection", "fn:handleMouseUp", "starts");
  edge("fn:handleMouseUp", "file:markdown-reader", "in");
  edge("fn:handleMouseUp", "fn:snapToWordBoundaries", "calls");
  edge("fn:handleMouseUp", "fn:read-handleWordClick", "then");
  edge("fn:read-handleWordClick", "fn:translatePhrase", "calls");
  edge("fn:translatePhrase", "file:claude", "in");
  edge("fn:translatePhrase", "route:translate-post", "http");

  edge("flow:enrich-nested", "fn:enrichWord", "calls");
  edge("fn:enrichWord", "file:claude", "in");
  edge("fn:enrichWord", "route:translate-enrich", "http");
  edge("route:translate-enrich", "file:route-translate", "in");
  edge("flow:enrich-nested", "fn:findNestedWordRef", "calls");
  edge("fn:findNestedWordRef", "file:definition-links", "in");
  edge("fn:findNestedWordRef", "fn:read-handleNestedLookup", "then");
  edge("fn:read-handleNestedLookup", "file:read-page", "in");
  edge("fn:read-handleNestedLookup", "fn:read-handleWordClick", "calls");

  edge("flow:cache-translation", "fn:cacheAcceptedTranslation", "starts");
  edge("fn:cacheAcceptedTranslation", "file:dictionary-client", "in");
  edge("fn:cacheAcceptedTranslation", "route:dict-cache", "http");
  edge("route:dict-cache", "fn:cacheAcceptedEntry", "calls");
  edge("fn:cacheAcceptedEntry", "file:dictionary-db", "in");
  edge("fn:cacheAcceptedEntry", "table:cached_entries", "writes");
  edge("flow:save-vocab", "flow:cache-translation", "then");

  // ── Vocab ─────────────────────────────────────────────────────────────────

  edge("flow:save-vocab", "fn:applyReaderWordState", "starts");
  edge("fn:applyReaderWordState", "file:read-page", "in");
  edge("fn:applyReaderWordState", "fn:patchWordState", "calls");
  edge("fn:patchWordState", "file:optimistic-state", "in");
  edge("fn:applyReaderWordState", "fn:saveVocab", "calls");
  edge("fn:applyReaderWordState", "fn:updateVocabState", "calls");
  edge("fn:saveVocab", "file:data-layer", "in");
  edge("fn:saveVocab", "route:vocab-post", "http");
  edge("route:vocab-post", "file:route-vocab", "in");
  edge("route:vocab-post", "table:vocab", "writes");
  edge("route:vocab-post", "table:knownWords", "writes");
  edge("fn:updateVocabState", "file:data-layer", "in");
  edge("fn:updateVocabState", "route:vocab-put", "http");
  edge("route:vocab-put", "table:vocab", "writes");
  edge("route:vocab-put", "table:knownWords", "writes");
  edge("file:translation-drawer", "fn:applyReaderWordState", "calls");

  edge("flow:vocab-list", "file:vocab-page", "starts");
  edge("file:vocab-page", "route:vocab-get", "http");
  edge("flow:known-word-import", "file:known-words-import", "starts");
  edge("file:known-words-import", "route:known-words-post", "http");
  edge("route:known-words-post", "table:knownWords", "writes");

  // ── Practice ──────────────────────────────────────────────────────────────

  edge("flow:practice-word", "fn:seedSentenceBank", "starts");
  edge("fn:seedSentenceBank", "file:data-layer", "in");
  edge("fn:seedSentenceBank", "route:cloze-seed", "http");
  edge("route:cloze-seed", "file:route-cloze", "in");
  edge("route:cloze-seed", "table:clozeSentences", "writes");
  edge("flow:practice-word", "fn:practice-startRoundWith", "then");
  edge("fn:practice-startRoundWith", "file:practice-page", "in");
  edge("fn:practice-startRoundWith", "route:cloze-due", "http");
  edge("route:cloze-due", "file:route-cloze", "in");
  edge("route:cloze-due", "table:clozeSentences", "reads");
  edge("fn:practice-startRoundWith", "fn:checkAnswer", "then");
  edge("fn:checkAnswer", "file:practice-utils", "in");
  edge("fn:checkAnswer", "fn:commitRoundReview", "then");
  edge("fn:commitRoundReview", "file:use-cloze-round", "in");
  edge("fn:commitRoundReview", "fn:persistReview", "calls");
  edge("fn:commitRoundReview", "fn:calculateNextReview", "calls");
  edge("fn:calculateNextReview", "file:practice-utils", "in");
  edge("fn:persistReview", "file:persist-review", "in");
  edge("fn:persistReview", "fn:updateClozeAfterReview", "calls");
  edge("fn:updateClozeAfterReview", "file:data-layer", "in");
  edge("fn:updateClozeAfterReview", "route:cloze-review", "http");
  edge("route:cloze-review", "table:clozeSentences", "writes");
  edge("fn:persistReview", "route:known-words-post", "http");
  edge("fn:persistReview", "fn:incrementDailyStat", "calls");
  edge("file:practice-page", "file:translation-drawer", "opens");
  edge("flow:practice-word", "flow:translate-word", "uses");

  edge("flow:dictation", "file:practice-page", "starts");
  edge("flow:dictation", "fn:speak", "calls");
  edge("flow:dictation", "fn:persistReview", "calls");
  edge("flow:blacklist", "route:cloze-put", "http");
  edge("route:cloze-put", "table:clozeSentences", "writes");

  // ── Journal ───────────────────────────────────────────────────────────────

  edge("flow:journal-submit", "fn:journal-handleSubmit", "starts");
  edge("fn:journal-handleSubmit", "file:journal-page", "in");
  edge("fn:journal-handleSubmit", "fn:createJournalEntry", "calls");
  edge("fn:journal-handleSubmit", "fn:updateJournalDraft", "calls");
  edge("fn:journal-handleSubmit", "fn:submitJournalForCorrection", "calls");
  edge("fn:createJournalEntry", "file:data-layer", "in");
  edge("fn:createJournalEntry", "route:journal-create", "http");
  edge("route:journal-create", "file:route-journal", "in");
  edge("route:journal-create", "table:journal_entries", "writes");
  edge("fn:updateJournalDraft", "route:journal-put", "http");
  edge("fn:submitJournalForCorrection", "file:data-layer", "in");
  edge("fn:submitJournalForCorrection", "route:journal-correct", "http");
  edge("route:journal-correct", "fn:correctJournalText", "calls");
  edge("fn:correctJournalText", "file:journal-correct", "in");
  edge("fn:correctJournalText", "fn:completeJson", "calls");
  edge("fn:correctJournalText", "fn:getProvider", "calls");
  edge("route:journal-correct", "table:journal_entries", "writes");
  edge("route:journal-correct", "file:entitlements", "meters");
  edge("file:journal-page", "file:correction-view", "opens");
  edge("route:journal-list", "table:journal_entries", "reads");
  edge("flow:journal-draft", "fn:createJournalEntry", "calls");
  edge("flow:journal-draft", "fn:updateJournalDraft", "calls");
  edge("fn:completeJson", "file:llm", "in");

  // ── Tutor ─────────────────────────────────────────────────────────────────

  edge("flow:tutor-chat", "fn:sendMessage", "starts");
  edge("fn:sendMessage", "file:chat-widget", "in");
  edge("fn:sendMessage", "route:chat-post", "http");
  edge("route:chat-post", "file:route-chat", "in");
  edge("route:chat-post", "fn:getProvider", "calls");
  edge("route:chat-post", "table:chat_messages", "writes");
  edge("route:chat-post", "file:entitlements", "meters");
  edge("flow:cloze-explain", "fn:handleExplain", "starts");
  edge("fn:handleExplain", "file:cloze-feedback", "in");
  edge("fn:handleExplain", "route:explain-post", "http");
  edge("route:explain-post", "file:route-explain", "in");
  edge("route:explain-post", "fn:getProvider", "calls");
  edge("flow:practice-word", "file:cloze-feedback", "opens");

  // ── Listen ────────────────────────────────────────────────────────────────

  edge("flow:speak-word", "fn:speak", "starts");
  edge("fn:speak", "file:tts", "in");
  edge("fn:speak", "route:tts-post", "http");
  edge("route:tts-post", "file:route-tts", "in");
  edge("flow:listen-along", "file:listen-along", "starts");
  edge("file:listen-along", "route:lessons-segments", "http");
  edge("file:listen-along", "route:lessons-audio", "http");
  edge("route:lessons-segments", "table:transcript_segments", "reads");
  edge("file:read-page", "file:listen-along", "opens");
  edge("flow:youtube-captions", "file:youtube-player", "starts");
  edge("file:markdown-reader", "file:youtube-player", "uses");
  edge("file:transcript-reader", "fn:read-handleWordClick", "calls");

  // ── Anki ──────────────────────────────────────────────────────────────────

  edge("flow:anki-push", "fn:useAnkiTransport", "starts");
  edge("fn:useAnkiTransport", "file:anki-transport", "in");
  edge("flow:anki-push", "fn:addWordCard", "calls");
  edge("fn:addWordCard", "file:anki-client", "in");
  edge("flow:anki-push", "fn:queueForAnki", "calls");
  edge("fn:queueForAnki", "file:anki-queue", "in");
  edge("fn:queueForAnki", "route:anki-queue", "http");
  edge("route:anki-queue", "file:route-anki", "in");
  edge("route:anki-queue", "table:anki_pending", "writes");
  edge("route:anki-pending", "table:anki_pending", "reads");
  edge("route:anki-ack", "table:vocab", "writes");
  edge("file:anki-addon", "route:anki-pending", "http");
  edge("file:anki-addon", "route:anki-ack", "http");
  edge("file:read-page", "fn:addWordCard", "calls");
  edge("file:read-page", "fn:queueForAnki", "calls");
  edge("flow:anki-sync", "fn:syncWordStates", "starts");
  edge("fn:syncWordStates", "file:anki-client", "in");
  edge("flow:anki-sync", "route:anki-reviews", "http");
  edge("route:anki-reviews", "table:vocab", "writes");
  edge("route:anki-reviews", "table:knownWords", "writes");
  edge("route:anki-reviews", "table:dailyStats", "writes");

  // ── Onboarding ────────────────────────────────────────────────────────────

  edge("flow:language-setup", "file:setup-guard", "starts");
  edge("file:setup-guard", "file:setup-page", "then");
  edge("file:setup-page", "fn:seedStarterContent", "calls");
  edge("fn:seedStarterContent", "file:data-layer", "in");
  edge("fn:seedStarterContent", "route:starter-seed", "http");
  edge("route:starter-seed", "file:route-starter", "in");
  edge("route:starter-seed", "file:starter-content", "uses");
  edge("route:starter-seed", "table:collections", "writes");
  edge("route:starter-seed", "table:lessons", "writes");
  edge("file:setup-page", "fn:startOnboarding", "calls");
  edge("fn:startOnboarding", "file:onboarding-client", "in");
  edge("fn:startOnboarding", "route:onboarding-start", "http");
  edge("route:onboarding-start", "file:route-onboarding", "in");
  edge("route:onboarding-start", "table:onboarding_progress", "writes");
  edge("flow:language-setup", "file:read-page", "then");
  edge("flow:language-setup", "file:practice-page", "then");

  // ── Stats ─────────────────────────────────────────────────────────────────

  edge("flow:daily-stats", "fn:incrementDailyStat", "starts");
  edge("route:stats-today", "file:route-stats", "in");
  edge("route:stats-today", "table:dailyStats", "writes");
  edge("flow:daily-stats", "fn:recordStudySessionPing", "uses");
  edge("file:stats-page", "flow:daily-stats", "reads");
  edge("flow:fluency-radar", "file:classify-worker", "starts");
  edge("file:classify-worker", "file:word-classifier", "uses");
  edge("file:classify-worker", "table:knownWords", "writes");
  edge("file:stats-page", "route:stats-fluency", "http");
  edge("route:stats-fluency", "fn:deriveDomainFluency", "calls");
  edge("fn:deriveDomainFluency", "file:domains-lib", "in");
  edge("file:entitlements", "table:usage_counters", "writes");

  // File-in-layer (so a file walk reaches the stack)
  edge("file:home-page", "layer:ui", "in");
  edge("file:read-page", "layer:ui", "in");
  edge("file:data-layer", "layer:client", "in");
  edge("file:claude", "layer:client", "in");
  edge("file:route-translate", "layer:routes", "in");
  edge("file:dictionary-db", "layer:lib", "in");
  edge("file:llm", "layer:lib", "in");

  global.LECTOR_FLOW_GRAPH = {
    nodes: nodes,
    edges: edges,
    errors: errors,
    repo: "https://github.com/heuwels/lector/blob/master/",
  };
})(typeof window !== "undefined" ? window : globalThis);
