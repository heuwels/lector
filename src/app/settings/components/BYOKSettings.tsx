'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-base';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ByokStatus {
  available: boolean;
  enabled: boolean;
  provider: 'openrouter';
  model: string;
  models: Array<{ id: string; label: string }>;
}

export default function BYOKSettings() {
  const [status, setStatus] = useState<ByokStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    const res = await apiFetch('/api/byok');
    if (!res.ok) throw new Error('Could not load BYOK settings');
    const next = (await res.json()) as ByokStatus;
    setStatus(next);
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
        body: JSON.stringify({ apiKey, model }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not enable BYOK');
      setApiKey('');
      setEditing(false);
      await load();
      toast.success('Your OpenRouter key is active');
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
      toast.success('Managed AI is active again');
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
        Use your own OpenRouter account for translations, explanations, journal corrections, and
        chat. Your key is encrypted at rest, never shown again, and removes managed-AI usage caps.
      </p>

      {status && !status.available ? (
        <p className="text-sm text-muted-foreground">
          BYOK is not configured on this deployment yet.
        </p>
      ) : status ? (
        <div className="space-y-4">
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
              {status.models.map((item) => (
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
                Disable
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground" htmlFor="byok-key">
                OpenRouter API key
              </label>
              <input
                id="byok-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-or-v1-…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
              <div className="flex gap-2">
                <Button onClick={save} disabled={saving || !apiKey.trim() || !model}>
                  {saving ? 'Validating…' : 'Validate and enable'}
                </Button>
                {status.enabled && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setApiKey('');
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
            Lector validates the key with OpenRouter before saving it. Provider errors never include
            your key.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </section>
  );
}
