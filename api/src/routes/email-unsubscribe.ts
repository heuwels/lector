import { Hono } from 'hono';
import { db } from '../db';
import { recordUnsubscribe, verifyUnsubscribeToken } from '../lib/email-unsubscribe';

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Lector email</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#2c2a23;">
  <h1 style="font-size:1.4rem;">You will not get more product emails</h1>
  <p>Lector will still send account mail such as verify, reset, and delete.</p>
</body>
</html>`;

const BAD = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Lector email</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#2c2a23;">
  <h1 style="font-size:1.4rem;">This stop link is not valid</h1>
  <p>Reply to the email if you still want to stop product mail.</p>
</body>
</html>`;

function applyToken(token: string | undefined): boolean {
  const email = token ? verifyUnsubscribeToken(token) : null;
  if (!email) return false;
  recordUnsubscribe(db, email, new Date().toISOString());
  return true;
}

const app = new Hono();

app.get('/', (c) => {
  const ok = applyToken(c.req.query('token'));
  return c.html(ok ? PAGE : BAD, ok ? 200 : 400);
});

app.post('/', async (c) => {
  const fromQuery = c.req.query('token');
  const body = await c.req.text().catch(() => '');
  const fromBody = new URLSearchParams(body).get('token') ?? undefined;
  const ok = applyToken(fromQuery || fromBody);
  if (!ok) return c.body(null, 400);
  return c.body(null, 200);
});

export default app;
