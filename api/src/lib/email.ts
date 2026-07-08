/**
 * Outbound email for account flows (#218): verification links and password
 * resets. The transport is resolved from env at first send:
 *
 *   - `RESEND_API_KEY` set → Resend's HTTP API (plain fetch, no SDK).
 *     `EMAIL_FROM` overrides the sender.
 *   - `EMAIL_FILE` set → append each message as a JSON line to that file.
 *     Exists for out-of-process tests (the two-user e2e reads verification
 *     links from it — a console log isn't reachable across the HTTP
 *     boundary) and doubles as a local outbox for debugging.
 *   - otherwise → the server log. The self-host/dev default: the link lands
 *     in the console, which is enough to complete signup/reset on your own
 *     box without wiring up an email service.
 *
 * Callers that must not fail the surrounding request (Better Auth's send
 * hooks) catch errors themselves; sendEmail always propagates failures.
 */
import { appendFileSync } from 'node:fs';

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
    appendFileSync(path, JSON.stringify(message) + '\n');
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
    const apiKey = process.env.RESEND_API_KEY;
    const filePath = process.env.EMAIL_FILE;
    transport = apiKey ? resendTransport(apiKey) : filePath ? fileTransport(filePath) : consoleTransport;
  }
  await transport(message);
}
