import { describe, test, expect, afterEach } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'fs';
import { resendPayload, sendEmail, setEmailTransport, type EmailMessage } from './email';

const FILE = '.test-data/emails-test.jsonl';

afterEach(() => {
  setEmailTransport(null);
  delete process.env.EMAIL_FILE;
  rmSync(FILE, { force: true });
});

describe('sendEmail transports', () => {
  test('an injected transport receives the message verbatim', async () => {
    const got: EmailMessage[] = [];
    setEmailTransport(async (m) => {
      got.push(m);
    });
    await sendEmail({ to: 'a@b.c', subject: 's', text: 't' });
    expect(got).toEqual([{ to: 'a@b.c', subject: 's', text: 't' }]);
  });

  test('EMAIL_FILE appends one JSON line per message (e2e reads links back out)', async () => {
    process.env.EMAIL_FILE = FILE;
    setEmailTransport(null); // re-resolve from env
    await sendEmail({ to: 'x@y.z', subject: 'Verify', text: 'https://example.com/verify?token=1' });
    await sendEmail({ to: 'x@y.z', subject: 'Reset', text: 'https://example.com/reset?token=2' });

    expect(existsSync(FILE)).toBe(true);
    const lines = readFileSync(FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].subject).toBe('Verify');
    expect(lines[1].text).toContain('token=2');
  });

  test('an injected transport receives a template send verbatim', async () => {
    const got: EmailMessage[] = [];
    setEmailTransport(async (m) => {
      got.push(m);
    });
    const message: EmailMessage = {
      to: 'a@b.c',
      subject: 'welcome-on-account-create',
      text: 'welcome-on-account-create',
      template: {
        id: 'welcome-on-account-create',
        variables: { USER_NAME: 'Ada', LANGUAGE: 'Afrikaans', APP_URL: 'https://app.lector.dev' },
      },
    };
    await sendEmail(message);
    expect(got).toEqual([message]);
  });

  test('EMAIL_FILE records the template field', async () => {
    process.env.EMAIL_FILE = FILE;
    setEmailTransport(null);
    await sendEmail({
      to: 'x@y.z',
      subject: 'anki-after-10-saved-words',
      text: 'anki-after-10-saved-words',
      template: { id: 'anki-after-10-saved-words', variables: { USER_NAME: 'Ada' } },
    });

    const line = JSON.parse(readFileSync(FILE, 'utf8').trim());
    expect(line.template.id).toBe('anki-after-10-saved-words');
    expect(line.template.variables.USER_NAME).toBe('Ada');
  });
});

describe('resendPayload', () => {
  test('a template send has the template id and omits text', () => {
    const payload = resendPayload('Support <support@lector.dev>', {
      to: 'a@b.c',
      subject: 'welcome-on-account-create',
      text: 'welcome-on-account-create',
      template: {
        id: 'welcome-on-account-create',
        variables: { USER_NAME: 'Ada' },
      },
    });
    expect(payload).toEqual({
      from: 'Support <support@lector.dev>',
      to: 'a@b.c',
      template: { id: 'welcome-on-account-create', variables: { USER_NAME: 'Ada' } },
    });
    expect(payload).not.toHaveProperty('text');
    expect(payload).not.toHaveProperty('html');
    expect(payload).not.toHaveProperty('subject');
  });

  test('a text send keeps subject and text', () => {
    expect(
      resendPayload('Lector <no-reply@lector.dev>', {
        to: 'a@b.c',
        subject: 'Verify your Lector email address',
        text: 'Confirm here',
      }),
    ).toEqual({
      from: 'Lector <no-reply@lector.dev>',
      to: 'a@b.c',
      subject: 'Verify your Lector email address',
      text: 'Confirm here',
    });
  });
});
