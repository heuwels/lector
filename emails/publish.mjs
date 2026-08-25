/**
 * Publish Lector onboarding and retention templates to Resend.
 *
 * Loads RESEND_API_KEY from the environment, then emails/.env, then .env
 * in the current directory. Does not print the key.
 * A publish replaces the live Resend copy. Pass one alias to limit the blast.
 *
 *   node emails/publish.mjs
 *   node emails/publish.mjs welcome-on-account-create
 *   node emails/publish.mjs --dry-run
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
};

const VARIABLES = [
  { key: 'USER_NAME', type: 'string', fallbackValue: 'there' },
  { key: 'LANGUAGE', type: 'string', fallbackValue: 'your language' },
  { key: 'APP_URL', type: 'string', fallbackValue: 'https://app.lector.dev' },
  { key: 'STOP_URL', type: 'string', fallbackValue: 'mailto:support@lector.dev' },
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

function layout({ preheader, title, paragraphs, ctaLabel, ctaHref, unsubscribe, video }) {
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

function textBody(paragraphs, ctaLabel, ctaHref, unsubscribe, video) {
  const lines = paragraphs.map(toPlain);
  if (video) lines.push('', `${video.label}: ${video.href}`);
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
    preheader: 'A short video if you want a hand getting started.',
    paragraphs: [
      'Hi {{{USER_NAME}}}.',
      'Thank you for signing up for Lector.',
      `Your library starts empty. When you are ready, add a lesson of your own: an EPUB, a page from the web, or text you paste. ${link(DOCS.reading, 'The reading guide')} covers that.`,
      "If you'd like a walkthrough of the learning loop, the Getting started video is below.",
      'Reply to this mail if you get stuck. I read it.',
    ],
    video: START_VIDEO,
    ctaLabel: 'Open Lector',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'day-1-registered-no-word-saved',
    name: 'Day 1 — registered, no word saved',
    subject: 'Need a hand with your first lesson?',
    unsubscribe: true,
    title: 'Your first lesson',
    preheader: 'No rush. Here is how to add something to read.',
    paragraphs: [
      "You created an account yesterday but it seems that you haven't created any lessons yet.",
      `We are working on adding starter content for each language, but for now your library may be looking a little empty. Add an EPUB, a URL, or paste text when you have a moment. ${link(DOCS.reading, 'The reading guide')} walks through each option.`,
      'The video below shows the loop after that: open a lesson, click a word you do not know, and save it.',
      'If something broke, or you want a hand picking a first text, please reply to this email.',
    ],
    video: START_VIDEO,
    ctaLabel: 'Open the library',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'day-3-registered-no-real-use',
    name: 'Day 3 — registered, no real use',
    subject: 'Just checking in',
    unsubscribe: true,
    title: 'How is it going?',
    preheader: 'No rush. I am here if you want a hand.',
    paragraphs: [
      "It's been a few days since you signed up. If you have not had a chance to add a text yet, no rush.",
      `The usual first step is to pick a language, then add something you actually want to read. ${link(DOCS.reading, 'The reading guide')} covers EPUB, web pages, and paste.`,
      'The Getting started video below is a short walkthrough if that helps.',
      'If you got stuck, or the app did something odd, reply to this mail and I will help.',
    ],
    video: START_VIDEO,
    ctaLabel: 'Open Lector',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'anki-after-10-saved-words',
    name: 'Anki — after ~10 saved words',
    subject: 'Want these words in Anki?',
    unsubscribe: true,
    title: 'Anki, if you use it',
    preheader: 'Optional. Your word list can sync with Anki.',
    paragraphs: [
      "Congratulations on your study. You have built a modest word list now. If you already use Anki, you can send those words over. Anki's spaced-repetition system can help you retain the vocabulary you encounter while you read.",
      `You can read the ${link(DOCS.anki, 'Getting started with Anki')} guide if Anki is new to you. ${link(DOCS.ankiAddon, 'The Lector add-on guide')} covers the two-way sync.`,
      'If a sync looks wrong, reply with the error text and I will take a look.',
    ],
    ctaLabel: 'Read the Anki guide',
    ctaHref: DOCS.anki,
  },
  {
    alias: 'gloss-cap-free-tier-limit-hit',
    name: 'Gloss cap — free tier limit hit',
    subject: "This month's free translations are used up",
    unsubscribe: true,
    title: 'A note on translations',
    preheader: 'The dictionary, Practice, and your word list still work.',
    paragraphs: [
      "You have used this month's free AI translations on Cloud.",
      'The offline dictionary, Practice, and your word list still work. Only the AI model-backed taps pause until the month resets.',
      `This will reset next month, but if you want the AI glosses back now, ${link(DOCS.pricing, 'Cloud starts at $5 a month')}. You can also export your data any time from Settings if you would like to convert to self-hosted. You can also bring your own AI key via our OpenRouter or Anthropic providers if you prefer.`,
      'Reply if you have questions about the limit, or if something looks off.',
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
    text: textBody(t.paragraphs, t.ctaLabel, t.ctaHref, t.unsubscribe, t.video),
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
  loadEnvFile(join(SCRIPT_DIR, '.env'));
  loadEnvFile(join(process.cwd(), '.env'));
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const deleteExtras = args.includes('--delete-extras');
  const onlyAlias = args.find((arg) => !arg.startsWith('--'));
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
