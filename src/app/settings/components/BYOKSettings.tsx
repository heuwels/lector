'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-base';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type ByokProvider = 'openrouter' | 'anthropic';
interface ProviderConfig {
  label: string;
  keyPlaceholder: string;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
}
interface ByokStatus {
  available: boolean;
  enabled: boolean;
  provider: ByokProvider;
  model: string;
  providers: Record<ByokProvider, ProviderConfig>;
}

export default function BYOKSettings() {
  const [status, setStatus] = useState<ByokStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<ByokProvider>('openrouter');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    const res = await apiFetch('/api/byok');
    if (!res.ok) throw new Error('Could not load BYOK settings');
    const next = (await res.json()) as ByokStatus;
    setStatus(next);
    setProvider(next.provider);
    setModel(next.model);
  };

  useEffect(() => {
    load().catch(() => toast.error('Could not load BYOK settings'));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/byok', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, model }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not enable BYOK');
      setApiKey('');
      setEditing(false);
      await load();
      toast.success(`Your ${status?.providers[provider].label ?? provider} key is active`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not enable BYOK');
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/byok', { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not disable BYOK');
      setApiKey('');
      setEditing(false);
      await load();
      toast.success('Reverted to Lector managed AI');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disable BYOK');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel p-6">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Bring your own AI key</h2>
        {status?.enabled && (
          <span className="rounded-full bg-[var(--primary-soft)] px-3 py-1 text-xs font-semibold text-primary">
            Active
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Use your own OpenRouter or Anthropic account for translations, explanations, journal
        corrections, and chat. Your key is encrypted at rest, never shown again, and removes
        managed-AI usage caps.
      </p>

      {status && !status.available ? (
        <p className="text-sm text-muted-foreground">
          BYOK is not configured on this deployment yet.
        </p>
      ) : status ? (
        <div className="space-y-4">
          <div>
            <label
              className="mb-2 block text-sm font-medium text-foreground"
              htmlFor="byok-provider"
            >
              Provider
            </label>
            <select
              id="byok-provider"
              value={provider}
              onChange={(event) => {
                const next = event.target.value as ByokProvider;
                setProvider(next);
                setModel(status.providers[next].defaultModel);
                setApiKey('');
              }}
              disabled={status.enabled && !editing}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
            >
              {Object.entries(status.providers).map(([id, config]) => (
                <option key={id} value={id}>
                  {config.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="byok-model">
              Model
            </label>
            <select
              id="byok-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={status.enabled && !editing}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
            >
              {status.providers[provider].models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          {status.enabled && !editing ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                Replace key or model
              </Button>
              <Button variant="destructive" onClick={disable} disabled={saving}>
                Revert to managed AI
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground" htmlFor="byok-key">
                {status.providers[provider].label} API key{' '}
                {status.enabled && provider === status.provider && (
                  <span className="font-normal text-muted-foreground">
                    (leave blank to keep it)
                  </span>
                )}
              </label>
              <input
                id="byok-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={status.providers[provider].keyPlaceholder}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
              <div className="flex gap-2">
                <Button
                  onClick={save}
                  disabled={
                    saving ||
                    !model ||
                    (!apiKey.trim() && (!status.enabled || provider !== status.provider))
                  }
                >
                  {saving ? 'Saving…' : status.enabled ? 'Save changes' : 'Validate and enable'}
                </Button>
                {status.enabled && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setApiKey('');
                      setProvider(status.provider);
                      setModel(status.model);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Lector validates the key with {status.providers[provider].label} before saving it.
            Provider errors never include your key.
          </p>
          <details className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">
              How your API key is protected
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                Keys are encrypted before they reach the database using AES-256-GCM with a fresh
                random nonce. Authentication data binds each ciphertext to your account and chosen
                provider, so an encrypted row cannot be moved to another account.
              </p>
              <p>
                The deployment encryption key is held separately in AWS Parameter Store. Your API
                key is write-only: Lector never sends it back to the browser, includes it in
                exports, or logs upstream credential details.
              </p>
              <p>
                Lector is open source, so you can verify how credentials are encrypted, stored, and
                selected at request time.{' '}
                <a
                  href="https://github.com/heuwels/lector"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Inspect the implementation
                </a>
                .
              </p>
            </div>
          </details>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </section>
  );
}
