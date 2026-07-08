/**
 * Outbound email for account flows (#218): verification links and password
 * resets. The transport is resolved from env at first send:
 *
 *   - `EMAIL_FILE` set → append one JSON line per message to that path.
 *     For the e2e suites (specs read verification/reset links back out — a
 *     console log isn't reachable across the HTTP boundary) and doubles as
 *     a local outbox for debugging. Wins over Resend so setting it always
 *     captures instead of sending.
 *   - `RESEND_API_KEY` set → Resend's HTTP API (plain fetch, no SDK).
 *     `EMAIL_FROM` overrides the sender.
 *   - otherwise → the server log. The self-host/dev default: the link lands
 *     in the console, which is enough to complete signup/reset on your own
 *     box without wiring up an email service.
 *
 * Callers that must not fail the surrounding request (Better Auth's send
 * hooks) catch errors themselves; sendEmail always propagates failures.
 */
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailTransport = (message: EmailMessage) => Promise<void>;

const consoleTransport: EmailTransport = async ({ to, subject, text }) => {
  console.log(`[email → console] to=${to} subject="${subject}"\n${text}`);
};

function fileTransport(path: string): EmailTransport {
  return async (message) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(message)}\n`);
  };
}

function resendTransport(apiKey: string): EmailTransport {
  const from = process.env.EMAIL_FROM || 'Lector <no-reply@lector.dev>';
  return async ({ to, subject, text }) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) {
      throw new Error(`Resend rejected email to ${to}: ${res.status} ${await res.text()}`);
    }
  };
}

let transport: EmailTransport | null = null;

/** Test seam: inject a capturing transport; pass null to re-resolve from env. */
export function setEmailTransport(t: EmailTransport | null): void {
  transport = t;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!transport) {
    const filePath = process.env.EMAIL_FILE;
    const apiKey = process.env.RESEND_API_KEY;
    transport = filePath
      ? fileTransport(filePath)
      : apiKey
        ? resendTransport(apiKey)
        : consoleTransport;
  }
  await transport(message);
}
