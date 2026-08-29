'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import WordCell from '@/components/WordCell';
import { splitWords } from '@/components/MarkdownReader/utils';
import { LANGUAGES, normalizeEnabledLanguages } from '@/lib/languages';
import {
  DEFAULT_PROSE_STYLE,
  PROSE_STYLE_LIMITS,
  hasLanguageOverride,
  inheritedProseStyle,
  proseStyleVars,
  resolveProseStyle,
  withGlobalProseStyle,
  withLanguageProseStyle,
  type ProseStyle,
  type ProseStyleOverride,
} from '@/lib/prose-style';
import type { LanguageCode } from '@/types/language';
import { useActiveLanguage, useEnabledLanguages, useProseStyleSettings } from '@/utils/hooks';
import { writeProseStyleSettings } from '@/utils/prose-style-storage';
import type { WordState } from '@/types';

/** 'global' edits every language. A language code edits that language only. */
type Scope = 'global' | LanguageCode;

const CONTROLS: {
  field: keyof ProseStyle;
  label: string;
  step: number;
  format: (value: number) => string;
  hint: string;
}[] = [
  {
    field: 'fontSize',
    label: 'Font size',
    step: 1,
    format: (value) => `${value}px`,
    hint: 'How big the body text of a lesson is.',
  },
  {
    field: 'fontWeight',
    label: 'Font weight',
    step: 100,
    format: (value) => String(value),
    hint: 'How heavy each word looks.',
  },
  {
    field: 'letterSpacing',
    label: 'Kerning',
    step: 0.005,
    format: (value) => `${value.toFixed(3)}em`,
    hint: 'Space between the letters. A negative value tightens them.',
  },
  {
    field: 'lineHeight',
    label: 'Leading',
    step: 0.05,
    format: (value) => value.toFixed(2),
    hint: 'Space between the lines, as a multiple of the font size.',
  },
];

/**
 * Reader typography (#570).
 *
 * Two scopes, because one set of numbers cannot serve every script. A reader
 * sets a size and a weight they like once, under "All languages", and then
 * corrects the one language whose script needs different treatment. Japanese is
 * the language that reported the problem: a leading tuned for Latin leaves its
 * lines too far apart.
 *
 * A language with no correction of its own inherits, and the panel says so. It
 * therefore also follows a later change to the global setting, which a copy of
 * the numbers into every language would not.
 */
export default function ProseSettings() {
  const activeLang = useActiveLanguage();
  const enabledCodes = useEnabledLanguages();
  const settings = useProseStyleSettings();
  const [scope, setScope] = useState<Scope>('global');

  const languages = useMemo(
    () => normalizeEnabledLanguages([...enabledCodes, activeLang.code]),
    [enabledCodes, activeLang.code],
  );

  // The pack the preview draws with. Under "All languages" that is whatever the
  // reader is studying now, so the sample is in a script they can read.
  const pack = LANGUAGES[scope === 'global' ? activeLang.code : scope];
  const customised = scope !== 'global' && hasLanguageOverride(settings, scope);

  // The layer BELOW the one being edited, which is what an untouched slider
  // shows and what a stored value is measured against.
  //
  // "All languages" sits above the app defaults and nothing else. It must NOT
  // pick up the active language's pack default: the numbers here apply to every
  // language, and seeding them from Japanese would push the Japanese leading
  // onto German the moment any slider moved.
  const baseline: ProseStyle =
    scope === 'global' ? DEFAULT_PROSE_STYLE : inheritedProseStyle(pack, settings);

  const shown: ProseStyle =
    scope === 'global'
      ? { ...DEFAULT_PROSE_STYLE, ...settings.global }
      : resolveProseStyle(pack, settings);

  /**
   * Store only the fields that differ from the layer below.
   *
   * A full copy would work today and go wrong later: a language that stated one
   * corrected leading would also freeze its size and weight, and would then
   * ignore the next change to "All languages". Storing the difference keeps
   * every field the reader did not touch following the layer below it.
   */
  function setField(field: keyof ProseStyle, value: number) {
    const next = { ...shown, [field]: value };
    const override: ProseStyleOverride = {};
    for (const key of Object.keys(DEFAULT_PROSE_STYLE) as (keyof ProseStyle)[]) {
      if (next[key] !== baseline[key]) override[key] = next[key];
    }
    writeProseStyleSettings(
      scope === 'global'
        ? withGlobalProseStyle(settings, override)
        : withLanguageProseStyle(settings, scope, override),
    );
  }

  function reset() {
    if (scope === 'global') {
      writeProseStyleSettings(withGlobalProseStyle(settings, {}));
      return;
    }
    writeProseStyleSettings(withLanguageProseStyle(settings, scope, {}));
  }

  return (
    <section className="panel p-6" data-testid="prose-settings">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Reading text</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        How the reader draws a lesson. Set what you like under All languages, then correct one
        language if its script needs different treatment. These settings stay on this device.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={scope === 'global' ? 'default' : 'secondary'}
          size="sm"
          data-testid="prose-scope-global"
          onClick={() => setScope('global')}
        >
          All languages
        </Button>
        {languages.map((code) => (
          <Button
            key={code}
            variant={scope === code ? 'default' : 'secondary'}
            size="sm"
            data-testid={`prose-scope-${code}`}
            onClick={() => setScope(code)}
          >
            <span aria-hidden="true">{LANGUAGES[code].flag}</span>
            {LANGUAGES[code].native}
            {hasLanguageOverride(settings, code) && (
              <span
                aria-label="has its own settings"
                className="ml-1 h-1.5 w-1.5 rounded-full bg-current opacity-70"
              />
            )}
          </Button>
        ))}
      </div>

      {scope !== 'global' && (
        <p className="mb-4 text-xs text-muted-foreground" data-testid="prose-inherits-notice">
          {customised
            ? `${LANGUAGES[scope].native} has settings of its own. Everything you leave alone still follows All languages.`
            : `${LANGUAGES[scope].native} follows your All languages settings. Move a slider to correct one of them.`}
        </p>
      )}

      <ProsePreview pack={pack} style={shown} />

      <div>
        {CONTROLS.map(({ field, label, step, format, hint }) => (
          <div key={field} className="mt-5">
            <label
              htmlFor={`prose-${field}`}
              className="mb-1 flex items-center justify-between text-sm font-medium text-foreground"
            >
              <span>
                {label}
                {scope !== 'global' && settings.byLanguage[scope]?.[field] !== undefined && (
                  <span className="ml-2 text-xs font-normal text-primary">set here</span>
                )}
              </span>
              <span
                className="font-mono text-muted-foreground"
                data-testid={`prose-${field}-value`}
              >
                {format(shown[field])}
              </span>
            </label>
            <input
              id={`prose-${field}`}
              data-testid={`prose-${field}`}
              type="range"
              min={PROSE_STYLE_LIMITS[field].min}
              max={PROSE_STYLE_LIMITS[field].max}
              step={step}
              value={shown[field]}
              onChange={(event) => setField(field, Number(event.target.value))}
              className="w-full accent-blue-500"
            />
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          data-testid="prose-reset"
          disabled={scope === 'global' ? Object.keys(settings.global).length === 0 : !customised}
          onClick={reset}
        >
          {scope === 'global' ? 'Reset to defaults' : `Reset ${LANGUAGES[scope].native}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          {scope === 'global'
            ? `The defaults are ${DEFAULT_PROSE_STYLE.fontSize}px, weight ${DEFAULT_PROSE_STYLE.fontWeight}, kerning 0 and leading ${DEFAULT_PROSE_STYLE.lineHeight}.`
            : `A reset makes ${LANGUAGES[scope].native} follow All languages again.`}
        </p>
      </div>
    </section>
  );
}

/**
 * The pack's own test phrase, drawn with the word chips the reader draws, so the
 * weight and the kerning show on the element they apply to. States are assigned
 * by position rather than from the vocabulary: a preview must look the same for
 * every account, and a lookup here would be a request per keystroke.
 */
const PREVIEW_STATES: WordState[] = ['known', 'level2', 'known', 'new', 'level4'];

/**
 * How many times the test phrase is repeated. A phrase is one line at any size
 * the sliders reach, and one line shows no leading at all — the control the
 * issue is really about. Three wraps at every size in the panel's width.
 */
const PREVIEW_REPEATS = 3;

function ProsePreview({
  pack,
  style,
}: {
  pack: (typeof LANGUAGES)[LanguageCode];
  style: ProseStyle;
}) {
  // The word state is picked by position, so the running count has to come out
  // of the split rather than out of a variable the map mutates.
  const parts = useMemo(() => {
    let wordIndex = -1;
    const phrase = Array(PREVIEW_REPEATS).fill(pack.testPhrase).join(' ');
    return splitWords(phrase, pack).map((part) => ({
      ...part,
      state: part.isWord ? PREVIEW_STATES[++wordIndex % PREVIEW_STATES.length] : undefined,
    }));
  }, [pack]);

  return (
    <div
      lang={pack.script.bcp47}
      dir={pack.script.direction}
      data-testid="prose-preview"
      className="rounded-lg border border-border bg-card p-4 text-foreground"
      style={{
        fontFamily: 'var(--font-literata), Georgia, serif',
        fontSize: 'var(--reader-font-size)',
        letterSpacing: 'var(--reader-letter-spacing)',
        lineHeight: 'var(--reader-line-height)',
        ...proseStyleVars(style, pack),
      }}
    >
      {parts.map((part, index) =>
        part.isWord ? (
          <WordCell key={index} text={part.text} state={part.state} testId="prose-preview-word" />
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </div>
  );
}
