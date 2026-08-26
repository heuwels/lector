/**
 * Publish Lector onboarding and retention templates to Resend.
 *
 * Loads RESEND_API_KEY from the environment, then emails/.env, then .env
 * in the current directory. Does not print the key.
 * A publish replaces the live Resend copy. Pass one alias to limit the blast.
 *
 *   node emails/publish.mjs
 *   node emails/publish.mjs welcome-on-account-create
 *   node emails/publish.mjs --print          read the copy, no network, no key
 *   node emails/publish.mjs --dry-run        compare against the live templates
 *   node emails/publish.mjs --delete-extras
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PAGE_SIZE = 100;

const FROM = 'Support <support@lector.dev>';
const REPLY_TO = 'support@lector.dev';
const API = 'https://api.resend.com';
const START_VIDEO = {
  href: 'https://youtu.be/r-RgyOj-4Co',
  thumb: 'https://i.ytimg.com/vi/r-RgyOj-4Co/hqdefault.jpg',
  label: 'Watch Getting started',
};

const COLORS = {
  sand: '#f3eee3',
  card: '#fffdf7',
  ink: '#2c2a23',
  muted: '#6b6356',
  sage: '#2f8a76',
  border: '#e9e1d0',
};

const DOCS = {
  reading: 'https://lector.dev/docs/features/',
  anki: 'https://lector.dev/docs/anki/',
  ankiAddon: 'https://lector.dev/docs/features/#anki-addon',
  pricing: 'https://lector.dev/pricing/',
  // The language interest form. LanguageNotify.astro renders under id
  // "languages" on the roadmap page, so the fragment lands on the form.
  requestLanguage: 'https://lector.dev/roadmap/#languages',
};

const VARIABLES = [
  { key: 'USER_NAME', type: 'string', fallbackValue: 'there' },
  { key: 'LANGUAGE', type: 'string', fallbackValue: 'your language' },
  { key: 'APP_URL', type: 'string', fallbackValue: 'https://app.lector.dev' },
  { key: 'STOP_URL', type: 'string', fallbackValue: 'mailto:support@lector.dev' },
  // A whole sentence about the library, because a template cannot branch and
  // the answer differs per language. Only de and es ship a starter series
  // today, and #315 seeds it on first language selection, so their library is
  // NOT empty. Telling those learners it is empty sends them off to find an
  // EPUB when twenty-two graded lessons are already waiting.
  // lifecycle-email.ts builds the sentence from hasStarterContent().
  {
    key: 'STARTER_LINE',
    type: 'string',
    fallbackValue:
      'Your library is empty until you add something, so start with a text you actually want to read.',
  },
  // The count the Anki mail is triggered by. Saying the number is evidence
  // that Lector is paying attention, which a vague "a modest word list" is not.
  { key: 'WORD_COUNT', type: 'string', fallbackValue: 'a few' },
  // Per-language reader screenshot, so one template covers every language
  // announcement. lector-site serves these from public/images/languages/ and
  // the language guide pages use the same file. The fallback is the generic
  // reader shot, which means a missing variable degrades to a real image and
  // never to a broken one.
  {
    key: 'SCREENSHOT_URL',
    type: 'string',
    fallbackValue: 'https://lector.dev/images/reader.png',
  },
];

function link(href, label) {
  return `<a href="${href}" style="color:${COLORS.sage};text-decoration:underline;">${label}</a>`;
}

function toPlain(html) {
  return html
    .replace(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g, '$2 ($1)')
    .replace(/<[^>]+>/g, '');
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/**
 * A screenshot, above the call to action. `video` renders the same shape but
 * links to YouTube; `image` links nowhere and carries a caption instead.
 *
 * Two rules for the asset. Host it under lector.dev, because an email client
 * needs an absolute URL and the Pages site already serves `public/`. Ship it
 * at 1120px wide, because the card is 560px and a retina client doubles that.
 *
 * Every client blocks images for some readers, so the caption and the alt text
 * have to carry the meaning on their own.
 */
function imageBlock(image) {
  if (!image) return '';
  const caption = image.caption
    ? `<p style="margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.5;color:${COLORS.muted};">${image.caption}</p>`
    : '';
  return `<tr>
            <td style="padding:8px 40px 16px;">
              <img src="${image.src}" width="480" alt="${image.alt}" style="display:block;width:100%;max-width:480px;height:auto;border-radius:8px;border:1px solid ${COLORS.border};">
              ${caption}
            </td>
          </tr>`;
}

function layout({ preheader, title, paragraphs, ctaLabel, ctaHref, unsubscribe, video, image }) {
  const paras = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.6;color:${COLORS.ink};">${p}</p>`,
    )
    .join('');

  const unsub = unsubscribe
    ? `<p style="margin:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.5;color:${COLORS.muted};"><a href="{{{STOP_URL}}}" style="color:${COLORS.muted};text-decoration:underline;">Stop these emails</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.sand};">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.sand};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="height:6px;background:${COLORS.sage};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 40px 8px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-style:italic;line-height:1.2;color:${COLORS.ink};">
              Lector
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 8px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:${COLORS.ink};">
              ${title}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 8px;">
              ${paras}
            </td>
          </tr>
          ${
            video
              ? `<tr>
            <td style="padding:8px 40px 16px;">
              <a href="${video.href}" style="display:block;text-decoration:none;">
                <img src="${video.thumb}" width="480" alt="${video.label}" style="display:block;width:100%;max-width:480px;height:auto;border-radius:8px;border:1px solid ${COLORS.border};">
              </a>
              <p style="margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;">
                <a href="${video.href}" style="color:${COLORS.sage};text-decoration:none;">${video.label}</a>
              </p>
            </td>
          </tr>`
              : ''
          }
          ${imageBlock(image)}
          <tr>
            <td style="padding:8px 40px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:999px;background:${COLORS.sage};">
                    <a href="${ctaHref}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.5;color:${COLORS.muted};border-top:1px solid ${COLORS.border};">
              <p style="margin:16px 0 0;">Lector · <a href="https://lector.dev" style="color:${COLORS.sage};text-decoration:none;">lector.dev</a></p>
              <p style="margin:8px 0 0;">Questions: <a href="mailto:support@lector.dev" style="color:${COLORS.sage};text-decoration:none;">support@lector.dev</a></p>
              ${unsub}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function textBody(paragraphs, ctaLabel, ctaHref, unsubscribe, video, image) {
  const lines = paragraphs.map(toPlain);
  if (video) lines.push('', `${video.label}: ${video.href}`);
  // The caption, not the URL. A plain-text reader cannot open a screenshot.
  if (image?.caption) lines.push('', toPlain(image.caption));
  lines.push('', `${ctaLabel}: ${ctaHref}`, '', 'Lector · https://lector.dev', 'Questions: support@lector.dev');
  if (unsubscribe) lines.push('Stop these emails: {{{STOP_URL}}}');
  return lines.join('\n');
}

const TEMPLATES = [
  {
    alias: 'welcome-on-account-create',
    name: 'Welcome - on account create',
    subject: 'Welcome to Lector',
    unsubscribe: false,
    title: 'Welcome to Lector',
    preheader: 'How the first ten minutes go.',
    paragraphs: [
      'Hi {{{USER_NAME}}}.',
      'Thank you for signing up for Lector. Here is how the first ten minutes go.',
      '{{{STARTER_LINE}}}',
      'Read a few lines, then tap a word you do not know. Lector saves it, marks it everywhere else it appears, and Practice starts building questions from it.',
      `You can add your own text at any point. ${link(DOCS.reading, 'The reading guide')} covers EPUB, a web page by URL, and text you paste.`,
      'Please reply to this email if you are having any issues, or if you want a hand picking a first text. I read every reply.',
    ],
    video: START_VIDEO,
    ctaLabel: 'Open Lector',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'day-1-registered-no-word-saved',
    name: 'Day 1 — registered, no word saved',
    // Fires on savedWordCount === 0, and on nothing else. The old copy said
    // "you haven't created any lessons yet", which this send cannot know and
    // which is false for anyone who imported a book and read it without saving
    // a word. Say what the trigger actually measures.
    subject: 'Save one word to switch on Practice',
    unsubscribe: true,
    title: 'Your first saved word',
    preheader: 'One tap is what starts the practice loop.',
    paragraphs: [
      'Hi {{{USER_NAME}}}.',
      'You have an account, but no saved words yet. That is the one step that switches the rest of Lector on.',
      '{{{STARTER_LINE}}}',
      'Open a lesson and tap a word you do not know. Lector saves it, marks it everywhere else it appears, and Practice builds cloze questions from the words you save.',
      `If you prefer your own text, ${link(DOCS.reading, 'the reading guide')} covers EPUB, a web page by URL, and text you paste.`,
      'Please reply to this email if you are having any issues, or if you want a hand picking a first text. I read every reply.',
    ],
    video: START_VIDEO,
    ctaLabel: 'Open the library',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'day-3-registered-no-real-use',
    name: 'Day 3 — registered, no real use',
    // Fires on !hasRealUse between three and seven days. hasRealUse counts
    // onboarding.completed, so this reader may well have picked a language
    // already. The old copy told them to do that first.
    //
    // No video here. A reader can receive welcome, day 1 and day 3, and the old
    // set put the same thumbnail in all three.
    subject: 'What do you want to read first?',
    unsubscribe: true,
    title: 'What do you want to read?',
    preheader: 'Tell me and I will help you get it into Lector.',
    paragraphs: [
      'Hi {{{USER_NAME}}}.',
      'You signed up a few days ago and have not read anything in Lector yet. That is usually one of two things. Either the text you want is not in there, or something did not work.',
      'Both are quick to fix. Tell me which one it is and I will sort it out.',
      `If it is the text: ${link(DOCS.reading, 'the reading guide')} covers EPUB, a web page by URL, and text you paste. An article you genuinely want to read beats a textbook chapter every time.`,
      '{{{STARTER_LINE}}}',
      'Please reply to this email if you are having any issues. One line about what happened is enough, and I read every reply.',
    ],
    ctaLabel: 'Open Lector',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'anki-after-10-saved-words',
    name: 'Anki — after ~10 saved words',
    subject: 'Send your saved words to Anki',
    unsubscribe: true,
    title: 'Your words can go to Anki',
    preheader: 'Optional. Your word list can sync both ways.',
    paragraphs: [
      'Hi {{{USER_NAME}}}.',
      'Your {{{LANGUAGE}}} word list holds {{{WORD_COUNT}}} words now. If you use Anki, Lector sends them across and keeps the two in step.',
      `${link(DOCS.anki, 'The Anki guide')} covers the setup if Anki is new to you. ${link(DOCS.ankiAddon, 'The add-on guide')} covers the two-way sync, which also notices a card you delete in Anki and marks the word unsynced.`,
      'Practice inside Lector works whether or not you use Anki, so treat this as optional.',
      'Please reply to this email if a sync looks wrong. Send the error text and I will take a look.',
    ],
    ctaLabel: 'Read the Anki guide',
    ctaHref: DOCS.anki,
  },
  {
    // Sent by ~/personal/lector-email/announce-language.mjs, once per person
    // per language, to the lector-site interest list. NOT a lifecycle template:
    // the app never sends this one, because that list lives in D1 and not in
    // the app database.
    alias: 'language-request-notification',
    name: 'Language request notification',
    // LANGUAGE fills the subject too. Send a test to yourself before a real
    // send and confirm the subject interpolates, because a template that
    // renders the variable in the body but not in the subject would ship a
    // literal {{{LANGUAGE}}} to the inbox line.
    subject: '{{{LANGUAGE}}} is now available on Lector',
    unsubscribe: true,
    title: '{{{LANGUAGE}}} is now available',
    preheader: 'The language you asked for is ready to read.',
    paragraphs: [
      'Hi there.',
      'You asked us to tell you when {{{LANGUAGE}}} was ready. That day is here.',
      `Open Lector, add {{{LANGUAGE}}} in the language picker, then add something you want to read. ${link(DOCS.reading, 'The reading guide')} covers EPUB, a web page by URL, and text you paste.`,
      'If you do not have an account yet, you can make one for free.',
      `Do you want another language? ${link(DOCS.requestLanguage, 'Ask for it on the roadmap')}, and we will tell you when it lands.`,
      `New to Lector? ${link(START_VIDEO.href, 'Getting started')} is a short walkthrough of the app.`,
      'Please reply to this email if you are having any issues. I read every reply.',
    ],
    // A screenshot of this language, not the video thumbnail. A learner who
    // waited for a language wants proof that the language reads correctly, and
    // the same asset serves the language guide page on the site.
    image: {
      src: '{{{SCREENSHOT_URL}}}',
      alt: '{{{LANGUAGE}}} text in the Lector reader, with a dictionary entry open beside it',
      caption: 'Tap any word to open its dictionary entry beside the text.',
    },
    ctaLabel: 'Open Lector',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'gloss-cap-free-tier-limit-hit',
    name: 'Gloss cap — free tier limit hit',
    // The cap is wordGlossesPerMonth on the free plan, and it gates the
    // translate route only. So the dictionary, Practice and the word list are
    // genuinely unaffected, which is the first thing to say.
    subject: 'Free translations used up — the dictionary still works',
    unsubscribe: true,
    title: 'A note on translations',
    preheader: 'The dictionary, Practice, and your word list are unaffected.',
    paragraphs: [
      'Hi {{{USER_NAME}}}.',
      'You reached this month\'s limit on free AI translations.',
      'Most of Lector carries on as normal. The on-device dictionary, Practice, and your word list are all unaffected. Only the AI translations pause, and they reset at the start of next month.',
      `If you want them back now, ${link(DOCS.pricing, 'Cloud starts at $5 a month')}.`,
      'There are two other routes, if a subscription is not what you want. You can add your own OpenRouter or Anthropic key in Settings and run the AI translations on your own account. You can also export everything from Settings and self-host Lector for nothing.',
      'Please reply to this email if the limit looks wrong, or if you are having any issues.',
    ],
    ctaLabel: 'See Cloud plans',
    ctaHref: DOCS.pricing,
  },
];

function toPayload(t) {
  return {
    name: t.name,
    alias: t.alias,
    from: FROM,
    reply_to: REPLY_TO,
    subject: t.subject,
    html: layout(t),
    text: textBody(t.paragraphs, t.ctaLabel, t.ctaHref, t.unsubscribe, t.video, t.image),
    variables: VARIABLES,
  };
}

async function resend(apiKey, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
  }
  return json;
}

async function listTemplates(apiKey) {
  const out = [];
  let after;
  for (;;) {
    const q = after ? `?limit=${PAGE_SIZE}&after=${after}` : `?limit=${PAGE_SIZE}`;
    const page = await resend(apiKey, 'GET', `/templates${q}`);
    const rows = page.data ?? page;
    const list = Array.isArray(rows) ? rows : rows.data ?? [];
    out.push(...list);
    if (list.length === 0 || list.length < PAGE_SIZE) break;
    after = list[list.length - 1].id;
  }
  return out;
}

function findExisting(existing, t) {
  const aliasHit = existing.find((row) => row.alias === t.alias);
  if (aliasHit) return aliasHit;
  const nameHit = existing.find(
    (row) => (row.name || '').toLowerCase() === t.name.toLowerCase(),
  );
  return nameHit ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const print = args.includes('--print');
  const deleteExtras = args.includes('--delete-extras');
  const onlyAlias = args.find((arg) => !arg.startsWith('--'));

  // --print renders the copy and reaches no network, so it needs no API key.
  // --dry-run lists the live templates first, which does, so it cannot be used
  // to read the copy before a key exists. Reviewing wording is the common case.
  if (print) {
    const chosen = onlyAlias
      ? TEMPLATES.filter((t) => t.alias === onlyAlias)
      : TEMPLATES;
    if (onlyAlias && chosen.length === 0) {
      console.error(`Unknown alias: ${onlyAlias}`);
      process.exit(1);
    }
    for (const t of chosen) {
      const payload = toPayload(t);
      console.log(`=== ${payload.alias} ===`);
      console.log(`subject:   ${payload.subject}`);
      console.log(`preheader: ${t.preheader}`);
      console.log(`--- text ---\n${payload.text}`);
      console.log(`--- html: ${payload.html.length} bytes ---\n`);
    }
    return;
  }

  loadEnvFile(join(SCRIPT_DIR, '.env'));
  loadEnvFile(join(process.cwd(), '.env'));
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set');
    process.exit(1);
  }

  const toPublish = onlyAlias
    ? TEMPLATES.filter((t) => t.alias === onlyAlias)
    : TEMPLATES;
  if (onlyAlias && toPublish.length === 0) {
    console.error(`Unknown alias: ${onlyAlias}`);
    process.exit(1);
  }

  const existing = await listTemplates(apiKey);
  console.log(`Resend has ${existing.length} template(s):`);
  for (const row of existing) {
    console.log(`  - ${row.name}  alias=${row.alias ?? 'none'}  status=${row.status}  id=${row.id}`);
  }

  for (const t of toPublish) {
    const payload = toPayload(t);
    const found = findExisting(existing, t);
    if (dryRun) {
      console.log(`Dry run ${t.alias} (${found ? found.id : 'create'})`);
      continue;
    }
    let id;
    if (found) {
      await resend(apiKey, 'PATCH', `/templates/${found.id}`, payload);
      id = found.id;
      console.log(`Updated ${t.alias} (${id})`);
    } else {
      const created = await resend(apiKey, 'POST', '/templates', payload);
      id = created.id;
      console.log(`Created ${t.alias} (${id})`);
    }
    await resend(apiKey, 'POST', `/templates/${id}/publish`);
    console.log(`Published ${t.alias}`);
  }

  if (!deleteExtras) return;

  const extraAliases = new Set([
    'onboarding-welcome',
    'onboarding-first-practice',
    'retention-day-3',
    'retention-day-7',
    'retention-day-14',
  ]);
  const extras = (await listTemplates(apiKey)).filter((row) => extraAliases.has(row.alias));
  for (const row of extras) {
    if (dryRun) {
      console.log(`Dry run delete ${row.alias} (${row.id})`);
      continue;
    }
    await resend(apiKey, 'DELETE', `/templates/${row.id}`);
    console.log(`Deleted extra ${row.alias} (${row.id})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
