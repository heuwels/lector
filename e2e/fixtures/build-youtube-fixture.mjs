// Generates e2e/fixtures/youtube-transcript.json — the fixtures the Hono API's
// LECTOR_YOUTUBE_FIXTURE seam serves instead of live YouTube (#334), so the
// transcript-import e2e never depends on the network. Shape:
//   { players:     { "<videoId>": <InnerTube player response> },
//     transcripts: { "<url-substring>": "<json3 body string>" } }
//
// Regenerate with: node e2e/fixtures/build-youtube-fixture.mjs
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));

const captionedPlayer = {
  videoDetails: { title: 'Klein Rooikappie', author: 'Storiekanaal' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=vid00000010&lang=af',
          name: { simpleText: 'Afrikaans' },
          languageCode: 'af',
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=vid00000010&lang=af&kind=asr',
          name: { simpleText: 'Afrikaans' },
          languageCode: 'af',
          kind: 'asr',
        },
      ],
    },
  },
};

const transcript = {
  events: [
    {
      tStartMs: 0,
      dDurationMs: 3000,
      segs: [{ utf8: 'Eendag was daar ' }, { utf8: 'n dogtertjie' }],
    },
    { tStartMs: 3000, dDurationMs: 4000, segs: [{ utf8: 'met die rooi kappie' }] },
    { tStartMs: 7000, dDurationMs: 3000, segs: [{ utf8: 'Sy loop deur die woud' }] },
  ],
};

const noCaptionsPlayer = { videoDetails: { title: 'Geen onderskrifte', author: 'Kanaal' } };

const fixtures = {
  players: {
    vid00000010: captionedPlayer,
    vid00000011: noCaptionsPlayer,
  },
  transcripts: {
    // Matched by url.includes against the json3 caption URL, which carries the id.
    'v=vid00000010': JSON.stringify(transcript),
  },
};

writeFileSync(join(here, 'youtube-transcript.json'), JSON.stringify(fixtures, null, 2) + '\n');
console.log('Wrote youtube-transcript.json');
