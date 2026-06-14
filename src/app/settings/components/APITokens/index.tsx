import { Button } from '@/components/ui/button';
import { ApiTokenMeta, createApiToken, getApiTokens, revokeApiToken } from '@/lib/data-layer';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function APITokens() {
  const [apiTokens, setApiTokens] = useState<ApiTokenMeta[]>([]);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenScopes, setNewTokenScopes] = useState<string[]>(['*']);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    getApiTokens()
      .then(setApiTokens)
      .catch(() => {
        toast.error('Failed to fetch API tokens');
      });
  }, []);

  const handleCopyTokenButtonPressed = () => {
    if (!createdToken) {
      return;
    }

    navigator.clipboard.writeText(createdToken);
    toast.success('Token copied to clipboard');
  };

  return (
    <section className="panel p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">API Tokens</h2>
        {!showTokenForm && !createdToken && (
          <Button
            onClick={() => {
              setShowTokenForm(true);
              setTokenError(null);
            }}
          >
            Generate Token
          </Button>
        )}
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Create personal access tokens for CLI or API access. Tokens are scoped to specific
        permissions.
      </p>

      {tokenError && (
        <div className="mb-4 rounded-md bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] p-3 text-sm text-destructive ">
          {tokenError}
        </div>
      )}

      {/* One-time token display */}
      {createdToken && (
        <div className="mb-4 rounded-md border border-[var(--gold-lip)] bg-[var(--gold-soft)] p-4 ">
          <p className="mb-2 text-sm font-medium text-[var(--gold-strong)] ">
            Copy this token now &mdash; it won&apos;t be shown again.
          </p>
          <div className="mb-2 flex items-center gap-2">
            <code className="flex-1 rounded border border-[var(--gold-lip)] bg-muted px-3 py-2 font-mono text-sm break-all text-foreground select-all   ">
              {createdToken}
            </code>
            <Button onClick={handleCopyTokenButtonPressed}>Copy</Button>
          </div>
          <Button variant="outline" onClick={() => setCreatedToken(null)}>
            I&apos;ve saved this token
          </Button>
        </div>
      )}

      {/* Create token form */}
      {showTokenForm && (
        <div className="mb-4 rounded-md border border-border bg-muted p-4">
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-foreground">
              Token Name
            </label>
            <input
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="e.g. CLI, Automation, Backup script"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none  "
            />
          </div>

          <div className="mb-3">
            <label className="mb-2 block text-sm font-medium text-foreground">
              Scopes
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: '*', label: 'Full Access' },
                { value: 'collections:read', label: 'Collections (read)' },
                { value: 'collections:write', label: 'Collections (write)' },
                { value: 'vocab:read', label: 'Vocabulary (read)' },
                { value: 'vocab:write', label: 'Vocabulary (write)' },
                { value: 'stats:read', label: 'Stats (read)' },
                { value: 'stats:write', label: 'Stats (write)' },
                { value: 'settings:read', label: 'Settings (read)' },
                { value: 'settings:write', label: 'Settings (write)' },
                { value: 'data:export', label: 'Data Export' },
                { value: 'data:import', label: 'Data Import' },
              ].map(({ value, label }) => (
                <label
                  key={value}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                    newTokenScopes.includes(value)
                      ? 'border-primary bg-[var(--primary-soft)] text-primary'
                      : 'border-input bg-background text-foreground   '
                  } ${
                    newTokenScopes.includes('*') && value !== '*'
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer hover:bg-accent'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={newTokenScopes.includes('*') || newTokenScopes.includes(value)}
                    disabled={newTokenScopes.includes('*') && value !== '*'}
                    onChange={(e) => {
                      if (value === '*') {
                        setNewTokenScopes(e.target.checked ? ['*'] : []);
                      } else {
                        setNewTokenScopes((prev) =>
                          e.target.checked
                            ? [...prev.filter((s) => s !== '*'), value]
                            : prev.filter((s) => s !== value),
                        );
                      }
                    }}
                    className="rounded"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (!newTokenName.trim()) {
                  setTokenError('Token name is required');
                  return;
                }
                if (newTokenScopes.length === 0) {
                  setTokenError('Select at least one scope');
                  return;
                }
                try {
                  setTokenError(null);
                  const result = await createApiToken({
                    name: newTokenName.trim(),
                    scopes: newTokenScopes,
                  });
                  setCreatedToken(result.token);
                  setShowTokenForm(false);
                  setNewTokenName('');
                  setNewTokenScopes(['*']);
                  const tokens = await getApiTokens();
                  setApiTokens(tokens);
                } catch (err) {
                  setTokenError(err instanceof Error ? err.message : 'Failed to create token');
                }
              }}
              disabled={!newTokenName.trim() || newTokenScopes.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create Token
            </button>
            <button
              onClick={() => {
                setShowTokenForm(false);
                setNewTokenName('');
                setNewTokenScopes(['*']);
                setTokenError(null);
              }}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Token list */}
      {apiTokens.length > 0 ? (
        <div className="space-y-2">
          {apiTokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between rounded-md border border-border bg-muted px-4 py-3  "
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {token.name}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {(token.scopes.includes('*') ? ['Full Access'] : token.scopes).map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-medium text-primary"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Created {new Date(token.createdAt).toLocaleDateString()}
                  {token.lastUsedAt
                    ? ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                    : ' · Never used'}
                </div>
              </div>
              <Button
                variant="destructive"
                onClick={async () => {
                  if (!confirm(`Revoke token "${token.name}"? This cannot be undone.`)) return;
                  await revokeApiToken(token.id);
                  setApiTokens((prev) => prev.filter((t) => t.id !== token.id));
                }}
                className="ml-3"
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      ) : (
        !showTokenForm && (
          <p className="text-sm text-muted-foreground">
            No tokens created yet. Generate one to use the CLI or access the API remotely.
          </p>
        )
      )}
    </section>
  );
}
