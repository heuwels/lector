import { describe, test, expect, afterEach } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'fs';
import { sendEmail, setEmailTransport, type EmailMessage } from './email';

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
});
