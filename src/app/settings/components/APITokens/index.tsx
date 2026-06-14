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
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">API Tokens</h2>
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

      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Create personal access tokens for CLI or API access. Tokens are scoped to specific
        permissions.
      </p>

      {tokenError && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {tokenError}
        </div>
      )}

      {/* One-time token display */}
      {createdToken && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
          <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            Copy this token now &mdash; it won&apos;t be shown again.
          </p>
          <div className="mb-2 flex items-center gap-2">
            <code className="flex-1 rounded border border-amber-200 bg-white px-3 py-2 font-mono text-sm break-all text-zinc-900 select-all dark:border-amber-800 dark:bg-zinc-800 dark:text-zinc-100">
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
        <div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Token Name
            </label>
            <input
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="e.g. CLI, Automation, Backup script"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </div>

          <div className="mb-3">
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                  } ${
                    newTokenScopes.includes('*') && value !== '*'
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700'
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
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
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
              className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {token.name}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {(token.scopes.includes('*') ? ['Full Access'] : token.scopes).map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
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
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No tokens created yet. Generate one to use the CLI or access the API remotely.
          </p>
        )
      )}
    </section>
  );
}
