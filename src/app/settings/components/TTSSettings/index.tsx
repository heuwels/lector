import { Button } from '@/components/ui/button';
import { getTTSMode, isGoogleTTSConfigured, setTTSMode, speak, TTSMode } from '@/lib/tts';
import { lectorMode } from '@/lib/api-base';
import { getEntitlements } from '@/lib/data-layer';
import { useActiveLanguage } from '@/utils/hooks';
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { SETTINGS_KEYS } from '../../constants';

export default function TTSSettings() {
  const [ttsSpeed, setTTSSpeed] = useState(1);
  const activeLang = useActiveLanguage();
  const [currentTTSMode, setCurrentTTSMode] = useState<TTSMode>('browser');
  const [googleTTSAvailable, setGoogleTTSAvailable] = useState<boolean | null>(null);
  const [managedTTSIncluded, setManagedTTSIncluded] = useState<boolean | null>(null);

  useEffect(() => {
    const init = async () => {
      setCurrentTTSMode(getTTSMode());
      setTTSSpeed(parseFloat(localStorage.getItem(SETTINGS_KEYS.TTS_SPEED) || '1.0'));

      if (lectorMode() === 'cloud') {
        const entitlements = await getEntitlements();
        const allowance = entitlements?.limits.ttsCharsPerMonth;
        if (allowance === 0) {
          // Free and Free+BYOK always use the browser voice. Clear a stale
          // managed preference left by a lapsed paid subscription so every
          // future Speak action stays local without a doomed API request.
          setManagedTTSIncluded(false);
          setGoogleTTSAvailable(false);
          setCurrentTTSMode('browser');
          setTTSMode('browser');
          return;
        }
        setManagedTTSIncluded(allowance === null || typeof allowance === 'number');
      }

      // Paid cloud and self-hosted deployments still verify that managed TTS
      // is configured before enabling it.
      setGoogleTTSAvailable(await isGoogleTTSConfigured());
    };

    void init();
  }, []);

  const handleTTSModeChanged = (ttsMode: TTSMode) => {
    setCurrentTTSMode(ttsMode);
    setTTSMode(ttsMode);
  };

  const handleTTSSpeedChanged = (e: ChangeEvent<HTMLInputElement>) => {
    const newVal = parseFloat(e.target.value);

    setTTSSpeed(newVal);
    localStorage.setItem(SETTINGS_KEYS.TTS_SPEED, `${newVal}`);
  };

  const testSpeaking = useCallback(() => {
    let samplePhrase = 'Hello, how are you?';

    switch (activeLang.code) {
      case 'af':
        samplePhrase = 'Hallo, hoe gaan dit met jou?';
        break;
      case 'de':
        samplePhrase = 'Hallo, wie geht es dir?';
        break;
      case 'es':
        samplePhrase = '¿Hola, cómo estás?';
        break;
    }

    speak(samplePhrase, ttsSpeed);
  }, [activeLang, ttsSpeed]);

  return (
    <section className="panel space-y-4 p-6" data-testid="tts-settings">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Text-to-Speech</h2>
        {googleTTSAvailable !== null && (
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                googleTTSAvailable ? 'bg-primary' : 'bg-yellow-500'
              }`}
            />
            <span className="text-sm text-muted-foreground">
              {managedTTSIncluded === false
                ? 'Browser voice · Free'
                : googleTTSAvailable
                  ? 'Managed voice available'
                  : 'Using browser voice'}
            </span>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground">Voice Engine</label>
        <p className="mb-2 text-xs text-muted-foreground">
          {managedTTSIncluded === false
            ? 'Browser speech stays free and works across reading, practice, and dictation. Cloud adds a consistent managed voice.'
            : 'Managed voices offer more consistent pronunciation; your browser voice is always available.'}
        </p>
        <div className="flex gap-2">
          <Button
            disabled={!googleTTSAvailable}
            onClick={() => handleTTSModeChanged('google')}
            variant={currentTTSMode === 'google' ? 'default' : 'secondary'}
          >
            Managed voice
          </Button>
          <Button
            onClick={() => handleTTSModeChanged('browser')}
            variant={currentTTSMode === 'browser' ? 'default' : 'secondary'}
          >
            Browser Built-in
          </Button>
        </div>
        {managedTTSIncluded === false && (
          <p className="mt-3 rounded-lg border border-border bg-[var(--primary-soft)] p-3 text-xs text-foreground">
            Want Lector&apos;s managed voice?{' '}
            <a href="/subscribe" className="font-semibold text-primary hover:underline">
              Upgrade to Cloud
            </a>
            . Adding your own AI key does not change audio because voice usage is hosted by Lector.
          </p>
        )}
      </div>

      <div>
        <Button onClick={testSpeaking}>Test Voice</Button>
      </div>

      <div>
        <label className="mb-2 flex items-center justify-between text-sm font-medium text-foreground">
          <span>Speech Speed</span>
          <span className="font-mono text-muted-foreground">{ttsSpeed.toFixed(1)}x</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.1"
          value={ttsSpeed}
          onChange={handleTTSSpeedChanged}
          className="w-full accent-blue-500"
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>0.5x (Slow)</span>
          <span>1.0x</span>
          <span>1.5x (Fast)</span>
        </div>
      </div>
    </section>
  );
}
