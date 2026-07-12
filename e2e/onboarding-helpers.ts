import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const externalServer = !!process.env.E2E_EXTERNAL_SERVER;

/**
 * Existing setup/starter specs predate terminal onboarding state and share the
 * selfhost `local` tenant. Let those specs exercise the new two-action UI and
 * real starter seeding without permanently consuming the one onboarding row;
 * onboarding.spec.ts owns the real skip/start persistence assertions.
 */
export async function mockSetupSkipPersistence(page: Page): Promise<void> {
  await page.route('**/api/onboarding/skip', async (route) => {
    const input = route.request().postDataJSON() as { language?: string };
    if (input.language) {
      // Preserve the pre-#331 side effect these compatibility specs depend on:
      // subsequent client navigations must see the selected server language.
      const settingsUrl = new URL(route.request().url());
      settingsUrl.pathname = '/api/settings/targetLanguage';
      settingsUrl.search = '';
      await page.request.put(settingsUrl.toString(), { data: { value: input.language } });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ progress: null, profile: null, events: [] }),
    });
  });
}

/**
 * Playwright's source-mode selfhost server has one intentional tenant. Reset
 * only #331's Spanish state between independent terminal scenarios so each
 * test gets a genuinely fresh learner without adding a production reset API.
 * The Docker/external pass cannot see the container DB and skips this spec.
 */
export function resetSelfhostOnboarding(): void {
  if (externalServer) return;

  const dbPath = path.resolve(process.cwd(), 'tmp/e2e-data/lector.db');
  const script = `
    import { Database } from 'bun:sqlite';
    const db = new Database(process.env.LECTOR_E2E_DB_PATH);
    db.run('PRAGMA busy_timeout = 5000');
    db.transaction(() => {
      db.run("DELETE FROM learner_events WHERE userId = 'local'");
      db.run("DELETE FROM onboarding_progress WHERE userId = 'local'");
      db.run("DELETE FROM learner_profiles WHERE userId = 'local'");
      db.run("DELETE FROM clozeSentences WHERE userId = 'local' AND language = 'es'");
      db.run("DELETE FROM vocab WHERE userId = 'local' AND language = 'es'");
      db.run("DELETE FROM knownWords WHERE userId = 'local' AND language = 'es'");
      db.run("DELETE FROM lessons WHERE userId = 'local' AND collectionId = 'starter-es'");
      db.run("DELETE FROM collections WHERE userId = 'local' AND id = 'starter-es'");
      db.run("DELETE FROM settings WHERE userId = 'local' AND key IN ('targetLanguage', 'starterSeeded:es')");
    })();
    db.close();
  `;
  execFileSync('bun', ['-e', script], {
    env: { ...process.env, LECTOR_E2E_DB_PATH: dbPath },
    stdio: 'pipe',
  });
}
