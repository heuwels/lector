# Listen domain

This domain is speech and audio lessons. YouTube captions share the Reader. They do not share the podcast player.

## Speak word

**App domain:** Listen

The drawer, the reader tap, and practice call `speak`.

```mermaid
flowchart TD
  speak[tts.speak] --> pack{pronunciation.audio}
  pack -->|none| stop[No speaker]
  pack -->|espeak| post["POST /api/tts"]
  pack -->|google| mode{lector-tts-mode}
  mode -->|browser| synth[speechSynthesis]
  mode -->|server| post
  post --> cache{TTS cache?}
  cache -->|hit| audio[audioContent]
  cache -->|miss| engine[espeak-ng or Google Cloud]
  engine --> audio
  post -->|fallback true| synth
```

### Key files

| Role | Path | Function |
| --- | --- | --- |
| Client | `src/lib/tts.ts` | `speak`, `speakWithServer`, `speakWithBrowser`, `hasAudio` |
| Settings | `src/app/settings/components/TTSSettings/index.tsx` | `TTSSettings` |
| API | `api/src/routes/tts.ts` | `POST /` |
| Cache | `api/src/lib/tts-cache.ts` | `getTtsCache`, `ttsCacheKey` |

Mode lives in `localStorage` key `lector-tts-mode`. Cloud Free with `ttsCharsPerMonth === 0` forces browser mode. A Google miss or absent key returns `{ fallback: true }`. Esperanto eSpeak does not fall back to the browser.

### Tables

No audio blob table. Meter is `usage_counters` for Google characters.

## Listen-along

**App domain:** Listen

Podcast import is the Library domain. Playback is this domain.

```mermaid
sequenceDiagram
  participant Read as ReadPage
  participant DL as data-layer
  participant API as lessons.ts
  participant Player as ListenAlong

  Read->>DL: getLesson
  Note over Read: transcriptionStatus done
  Read->>DL: getLessonSegments
  DL->>API: GET /api/lessons/:id/segments
  Read->>Player: listenMode on
  Player->>API: GET /api/lessons/:id/audio
  Note over API: Range, 206
  Player->>Player: createAudioUnitPlayer
```

| Role | Path | Function |
| --- | --- | --- |
| Reader | `src/app/read/[bookId]/page.tsx` | listen mode toggle |
| Player | `src/components/ListenAlong/index.tsx` | `ListenAlong` |
| Units | `src/components/ListenAlong/drill-player.ts` | `createAudioUnitPlayer` |
| Client | `src/lib/data-layer.ts` | `getLessonSegments`, `lessonAudioUrl` |
| API | `api/src/routes/lessons.ts` | `GET /:id/segments`, `GET /:id/audio` |
| Worker | `api/src/lib/transcribe-worker.ts` | `applyTranscript` |

Word tap pauses and opens the Translation drawer. Shadow mode repeats a unit.

Tables: `lessons`, `transcript_segments`. Files under `AUDIO_DIR`.

Tests: `e2e/audio-import.spec.ts`.

## YouTube captions

**App domain:** Listen. Import is the Library domain.

| Role | Path | Function |
| --- | --- | --- |
| Reader | `src/components/MarkdownReader/index.tsx` | youtube branch |
| Player | `src/components/YouTubePlayer/index.tsx` | `seekTo` |
| Cues | `src/components/MarkdownReader/TranscriptReader.tsx` | `onSeek`, `onWordClick` |

Cues live on `lessons.segments` JSON, not `transcript_segments`. Listen-along does not mount.

Tests: `e2e/youtube-transcript.spec.ts`.
