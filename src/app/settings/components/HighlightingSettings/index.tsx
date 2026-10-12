'use client';

import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '@/lib/data-layer';

/**
 * Highlighting configuration settings for the reading mode.
 * Stored as part of the app settings (Settings → Appearance → Reading Mode).
 */
export function useHighlightingSettings() {
  const [padding, setPadding] = useState(3); // default 3px
  const [transparency, setTransparency] = useState(0.2); // default 0.2 for light mode
  const [borderRadius, setBorderRadius] = useState(5); // default 5px rounded corners
  const [highlightColor, setHighlightColor] = useState('--primary'); // default uses primary CSS var
  const [phraseBorderStyle, setPhraseBorderStyle] = useState('solid');
  const [persistHighlights, setPersistHighlights] = useState(false);
  const [autoRestoreHighlights, setAutoRestoreHighlights] = useState(false);

  // Load settings from server on mount - run once effect
  useEffect(() => {
    ;(async () => {
      const pv = await getSetting<number>('highlightPadding');
      if (pv !== undefined) setPadding(pv);
      const tv = await getSetting<number>('highlightTransparency');
      if (tv !== undefined) setTransparency(tv);
      const brv = await getSetting<number>('highlightBorderRadius');
      if (brv !== undefined) setBorderRadius(brv);
      const hcv = await getSetting<string>('highlightColor');
      if (hcv !== undefined) setHighlightColor(hcv);
      const pbsv = await getSetting<string>('phraseBorderStyle');
      if (pbsv !== undefined) setPhraseBorderStyle(pbsv);
      const persistV = await getSetting<boolean>('persistHighlights');
      if (persistV !== undefined) setPersistHighlights(persistV);
      const restoreV = await getSetting<boolean>('autoRestoreHighlights');
      if (restoreV !== undefined) setAutoRestoreHighlights(restoreV);
    })();
  }, []);

  const updateSetting = async (key: string, value: unknown) => {
    await setSetting(key, value);
    // Update local state immediately
    switch (key) {
      case 'highlightPadding':
        setPadding(value as number);
        break;
      case 'highlightTransparency':
        setTransparency(value as number);
        break;
      case 'highlightBorderRadius':
        setBorderRadius(value as number);
        break;
      case 'highlightColor':
        setHighlightColor(value as string);
        break;
      case 'phraseBorderStyle':
        setPhraseBorderStyle(value as string);
        break;
      case 'persistHighlights':
        setPersistHighlights(value as boolean);
        break;
      case 'autoRestoreHighlights':
        setAutoRestoreHighlights(value as boolean);
        break;
    }
  };

  return {
    padding,
    transparency,
    borderRadius,
    highlightColor,
    phraseBorderStyle,
    persistHighlights,
    autoRestoreHighlights,
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