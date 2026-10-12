'use client';

import { useEffect, useState } from 'react';
import { ensureCache, cache } from '@/lib/highlightingSettingsStore';

/**
 * Highlighting configuration settings for the reading mode.
 * Stored as part of the app settings (Settings → Appearance → Reading Mode).
 *
 * This hook now reads from the shared cache (single /api/settings request)
 * instead of firing 7 per-key getSetting() calls on every mount.
 */
export function useHighlightingSettings() {
  const [state, setState] = useState<{
    padding: number;
    transparency: number;
    borderRadius: number;
    highlightColor: string;
    phraseBorderStyle: string;
    persistHighlights: boolean;
    autoRestoreHighlights: boolean;
  }>({
    padding: 3,
    transparency: 0.2,
    borderRadius: 5,
    highlightColor: '--primary',
    phraseBorderStyle: 'solid',
    persistHighlights: false,
    autoRestoreHighlights: false,
  });

  useEffect(() => {
    ;(async () => {
      // Populate the shared cache once; no per-key fetches.
      const data = await ensureCache();
      setState({
        padding: (data.highlightPadding as number),
        transparency: (data.highlightTransparency as number),
        borderRadius: (data.highlightBorderRadius as number),
        highlightColor: (data.highlightColor as string),
        phraseBorderStyle: (data.phraseBorderStyle as string),
        persistHighlights: data.persistHighlights === true,
        autoRestoreHighlights: data.autoRestoreHighlights === true,
      });
    })();
  }, []);

  const updateSetting = async (key: string, value: unknown) => {
    // Update the shared cache so other consumers (WordCell) see the change.
    ;(cache as Record<string, unknown>)[key] = value;

    // Update local UI state immediately.
    setState((prev) => ({ ...prev, [key]: value }));

    // Persist to server — this is an explicit user action, not per-word.
    await fetch(`/api/settings/${key}`, {
      method: 'PUT',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  };

  return {
    padding: state.padding,
    transparency: state.transparency,
    borderRadius: state.borderRadius,
    highlightColor: state.highlightColor,
    phraseBorderStyle: state.phraseBorderStyle,
    persistHighlights: state.persistHighlights,
    autoRestoreHighlights: state.autoRestoreHighlights,
    updateSetting,
  };
}

/**
 * Renders the highlighting settings UI.
 */
export default function HighlightingSettings() {
  const {
    padding,
    transparency,
    borderRadius,
    highlightColor,
    phraseBorderStyle,
    persistHighlights,
    autoRestoreHighlights,
    updateSetting,
  } = useHighlightingSettings();

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium mb-4">Reading Mode Highlighting</h2>

      {/* Word highlight padding */}
      <div>
        <label className="block text-sm font-medium mb-2">Word highlight padding (px)</label>
        <input
          type="number"
          min={1}
          max={20}
          value={padding}
          onChange={(e) => updateSetting('highlightPadding', Number(e.target.value))}
          className="w-full rounded border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Transparency level */}
      <div>
        <label className="block text-sm font-medium mb-2">Highlight transparency</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={transparency}
          onChange={(e) => updateSetting('highlightTransparency', Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs mt-1">
          <span>Low</span>
          <span>{transparency.toFixed(1)}</span>
          <span>High</span>
        </div>
      </div>

      {/* Border radius */}
      <div>
        <label className="block text-sm font-medium mb-2">Border radius</label>
        <input
          type="number"
          min={0}
          max={999}
          value={borderRadius}
          onChange={(e) => updateSetting('highlightBorderRadius', Number(e.target.value))}
          className="w-full rounded border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Higher values = more rounded corners. 0 = sharp corners.
        </p>
      </div>

      {/* Highlight color - uses CSS var by default */}
      <div>
        <label className="block text-sm font-medium mb-2">Highlight color</label>
        <select
          value={highlightColor}
          onChange={(e) => updateSetting('highlightColor', e.target.value)}
          className="w-full rounded border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="--primary">Use primary color (auto-dark/light)</option>
          <option value="--clay">Use clay color</option>
          <option value="var(--primary)">Custom var</option>
          <option value="#3b82f6">Blue</option>
          <option value="#ef4444">Red</option>
          <option value="#10b981">Green</option>
          <option value="#f59e0b">Amber</option>
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          Select the color used for word highlights. Use primary color auto-adapts to dark/light mode.
        </p>
      </div>

      {/* Phrase border style */}
      <div>
        <label className="block text-sm font-medium mb-2">Phrase/sentence border style</label>
        <div className="grid grid-cols-4 gap-2 mt-2">
          {[['solid', 'Solid'], ['double', 'Double'], ['dashed', 'Dashed'], ['dotted', 'Dotted']].map(
            ([style, label]) => (
              <button
                key={style}
                onClick={() => updateSetting('phraseBorderStyle', style)}
                className={`rounded-md transition-colors ${
                  phraseBorderStyle === style
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-muted-foreground hover:bg-primary/5 hover:text-primary'
                } px-3 py-1 text-sm`}
              >
                {label}
              </button>
            )
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Style of the rectangle border around multi-word selections.
        </p>
      </div>

{/* Persistence settings */}
      <div className="pt-4 border-t border-border">
        <h3 className="text-sm font-medium mb-3">Persistence</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={persistHighlights}
              onChange={(e) => updateSetting('persistHighlights', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <span className="text-sm font-medium">Persist phrase highlights</span>
              <p className="text-xs text-muted-foreground mt-1">
                Save phrase highlights to the server so they persist across lessons. Affects all three selection methods (click, drag, Shift+Arrow).
              </p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRestoreHighlights}
              onChange={(e) => updateSetting('autoRestoreHighlights', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <span className="text-sm font-medium">Auto-restore highlights on lesson load</span>
              <p className="text-xs text-muted-foreground mt-1">
                Automatically highlight previously saved phrases when opening a lesson that contains those words.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Live Preview */}
      <div className="pt-4 border-t border-border">
        <h3 className="text-sm font-medium mb-3">Preview</h3>
        <div className="space-y-3 p-4 bg-card border border-border rounded-lg">
          <div className="text-sm text-muted-foreground">Word highlight (single click):</div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium rounded"
                  style={{
                    backgroundColor: highlightColor === '--primary' ? 'color-mix(in srgb, var(--primary) 20%, transparent)' :
                                 highlightColor === '--clay' ? 'color-mix(in srgb, var(--clay) 20%, transparent)' :
                                 highlightColor.startsWith('var(') ? `color-mix(in srgb, ${highlightColor} 20%, transparent)` :
                                 highlightColor + '33',
                    opacity: transparency,
                  }}>
              highlighted
            </span>
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium rounded"
                  style={{
                    backgroundColor: highlightColor === '--primary' ? 'color-mix(in srgb, var(--primary) 20%, transparent)' :
                                 highlightColor === '--clay' ? 'color-mix(in srgb, var(--clay) 20%, transparent)' :
                                 highlightColor.startsWith('var(') ? `color-mix(in srgb, ${highlightColor} 20%, transparent)` :
                                 highlightColor + '33',
                    opacity: transparency,
                    border: `2px ${phraseBorderStyle} ${phraseBorderStyle === 'solid' ? 'currentColor' : 'currentColor'}`,
                    borderRadius: `${borderRadius}px`,
                  }}>
              active word
            </span>
          </div>
          <div className="text-sm text-muted-foreground mt-4">Phrase highlight (drag/shift+arrow):</div>
          <div className="flex flex-wrap gap-1">
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium rounded border-b-2"
                  style={{
                    borderStyle: phraseBorderStyle,
                    borderColor: 'var(--w-l1-bd)',
                    borderRadius: `${borderRadius}px 0 0 ${borderRadius}px`,
                    opacity: 0.3,
                  }}>
              first
            </span>
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium rounded border-b-2"
                  style={{
                    borderStyle: phraseBorderStyle,
                    borderColor: 'var(--w-l1-bd)',
                    opacity: 0.3,
                  }}>
              middle
            </span>
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium rounded border-b-2"
                  style={{
                    borderStyle: phraseBorderStyle,
                    borderColor: 'var(--w-l1-bd)',
                    borderRadius: `0 ${borderRadius}px ${borderRadius}px 0`,
                    opacity: 0.3,
                  }}>
              last
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium rounded border-b-2"
                  style={{
                    borderStyle: phraseBorderStyle,
                    borderColor: 'var(--w-l3-bd)',
                    borderRadius: `${borderRadius}px 0 0 ${borderRadius}px`,
                    opacity: 0.3,
                  }}>
              level 1
            </span>
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium rounded border-b-2"
                  style={{
                    borderStyle: phraseBorderStyle,
                    borderColor: 'var(--w-l3-bd)',
                    opacity: 0.3,
                  }}>
              level 3
            </span>
            <span className="inline-flex items-center px-2 py-1 text-sm font-medium rounded border-b-2"
                  style={{
                    borderStyle: phraseBorderStyle,
                    borderColor: 'var(--w-l3-bd)',
                    borderRadius: `0 ${borderRadius}px ${borderRadius}px 0`,
                    opacity: 0.3,
                  }}>
              level 5
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}