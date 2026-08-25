/**
 * Publish Lector onboarding and retention templates to Resend.
 *
 * Loads RESEND_API_KEY from ~/personal/.env or the environment.
 * Upserts by alias, then publishes. Does not print the key.
 *
 *   node emails/publish.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

const VARIABLES = [
  { key: 'USER_NAME', type: 'string', fallbackValue: 'there' },
  { key: 'LANGUAGE', type: 'string', fallbackValue: 'your language' },
  { key: 'APP_URL', type: 'string', fallbackValue: 'https://app.lector.dev' },
  { key: 'STOP_URL', type: 'string', fallbackValue: 'mailto:support@lector.dev' },
];

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
  const lines = [...paragraphs];
  if (video) lines.push('', `${video.label}: ${video.href}`);
  lines.push('', `${ctaLabel}: ${ctaHref}`, '', 'Lector · https://lector.dev', 'Questions: support@lector.dev');
  if (unsubscribe) lines.push('Stop these emails: {{{STOP_URL}}}');
  return lines.join('\n');
}

const TEMPLATES = [
  {
    alias: 'welcome-on-account-create',
    name: 'Welcome - on account create',
    subject: 'Your Lector library is ready',
    unsubscribe: false,
    title: 'Your library is ready',
    preheader: 'Watch Getting started. Then pick a language.',
    paragraphs: [
      'Hi {{{USER_NAME}}}.',
      'You have an account on Lector Cloud. There is no card on file.',
      'Watch Getting started. Then pick a language.',
      'The app adds a starter series for that language. The library is not empty on day one.',
      'Open a lesson. Click a word you do not know. Save it.',
    ],
    video: START_VIDEO,
    ctaLabel: 'Open Lector',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'day-1-registered-no-word-saved',
    name: 'Day 1 — registered, no word saved',
    subject: 'Save one word to start the list',
    unsubscribe: true,
    title: 'Save one word',
    preheader: 'Open the first lesson. Save one unknown word.',
    paragraphs: [
      'You created an account yesterday. The starter series is in your library.',
      'Open the first lesson. Click a word you do not know. Save it.',
      'That word goes into Practice and Anki later.',
      'If the app failed, reply to this mail.',
    ],
    video: START_VIDEO,
    ctaLabel: 'Open the library',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'day-3-registered-no-real-use',
    name: 'Day 3 — registered, no real use',
    subject: 'Open Lector for five minutes',
    unsubscribe: true,
    title: 'Give it five minutes',
    preheader: 'Pick a language. Open the first starter text.',
    paragraphs: [
      'This account has no real use after three days.',
      'If you did not pick a language, pick one now.',
      'Open the first starter text. Read for five minutes.',
      'Cloud has no card. You can also self-host.',
    ],
    video: START_VIDEO,
    ctaLabel: 'Open Lector',
    ctaHref: '{{{APP_URL}}}',
  },
  {
    alias: 'anki-after-10-saved-words',
    name: 'Anki — after ~10 saved words',
    subject: 'Your words can live in Anki',
    unsubscribe: true,
    title: 'Send words to Anki',
    preheader: 'You saved enough words for a first deck.',
    paragraphs: [
      'You saved enough words for a first deck.',
      'Install the Lector Sync add-on. The AnkiWeb code is 1098736891.',
      'Create a token under Settings, then API Tokens. Use the anki scope. Sync once.',
      'Reviews you grade in Anki come back into Lector. The add-on is beta.',
      'If sync fails, reply with the error text.',
    ],
    ctaLabel: 'Read the Anki guide',
    ctaHref: 'https://lector.dev/docs/features/#anki-addon',
  },
  {
    alias: 'gloss-cap-free-tier-limit-hit',
    name: 'Gloss cap — free tier limit hit',
    subject: 'Free translations used up this month',
    unsubscribe: true,
    title: 'The free gloss limit is full',
    preheader: 'The offline dictionary and Practice still work.',
    paragraphs: [
      'You used the free Cloud limit for AI glosses this month.',
      'The offline dictionary, Practice, and your word list still work. The model taps pause.',
      'Cloud is $5 each month if you want the glosses now. Or wait for the month reset.',
      'Export at any time from Settings.',
    ],
    ctaLabel: 'See Cloud plans',
    ctaHref: 'https://lector.dev/pricing/',
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
    const q = after ? `?limit=100&after=${after}` : '?limit=100';
    const page = await resend(apiKey, 'GET', `/templates${q}`);
    const rows = page.data ?? page;
    const list = Array.isArray(rows) ? rows : rows.data ?? [];
    out.push(...list);
    if (!page.has_more || list.length === 0) break;
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
  loadEnvFile(join(homedir(), 'personal', '.env'));
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set. Add it to ~/personal/.env');
    process.exit(1);
  }

  const existing = await listTemplates(apiKey);
  console.log(`Resend has ${existing.length} template(s):`);
  for (const row of existing) {
    console.log(`  - ${row.name}  alias=${row.alias ?? 'none'}  status=${row.status}  id=${row.id}`);
  }

  for (const t of TEMPLATES) {
    const payload = toPayload(t);
    const found = findExisting(existing, t);
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

  const extraAliases = new Set([
    'onboarding-welcome',
    'onboarding-first-practice',
    'retention-day-3',
    'retention-day-7',
    'retention-day-14',
  ]);
  const extras = (await listTemplates(apiKey)).filter((row) => extraAliases.has(row.alias));
  for (const row of extras) {
    await resend(apiKey, 'DELETE', `/templates/${row.id}`);
    console.log(`Deleted extra ${row.alias} (${row.id})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
