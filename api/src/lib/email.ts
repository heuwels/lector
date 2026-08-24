/**
 * Outbound email for account flows (#218) and lifecycle templates (#558).
 * The transport is resolved from env at first send:
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

export interface EmailTemplate {
  id: string;
  variables?: Record<string, string | number>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Resend template. The HTML stays on Resend. Auth mail omits this. */
  template?: EmailTemplate;
}

export type EmailTransport = (message: EmailMessage) => Promise<void>;

const consoleTransport: EmailTransport = async (message) => {
  const template = message.template ? ` template=${message.template.id}` : '';
  console.log(
    `[email → console] to=${message.to} subject="${message.subject}"${template}\n${message.text}`,
  );
};

function fileTransport(path: string): EmailTransport {
  return async (message) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(message)}\n`);
  };
}

/** Body for Resend. A template send must not include text or HTML. */
export function resendPayload(from: string, message: EmailMessage): Record<string, unknown> {
  if (message.template) {
    return {
      from,
      to: message.to,
      template: {
        id: message.template.id,
        variables: message.template.variables ?? {},
      },
    };
  }
  return { from, to: message.to, subject: message.subject, text: message.text };
}

function senderFor(message: EmailMessage): string {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  return message.template ? 'Support <support@lector.dev>' : 'Lector <no-reply@lector.dev>';
}

function resendTransport(apiKey: string): EmailTransport {
  return async (message) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload(senderFor(message), message)),
    });
    if (!res.ok) {
      throw new Error(`Resend rejected email to ${message.to}: ${res.status} ${await res.text()}`);
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
