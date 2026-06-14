import { Button } from '@/components/ui/button';
import { getTTSMode, isGoogleTTSConfigured, setTTSMode, speak, TTSMode } from '@/lib/tts';
import { useActiveLanguage } from '@/utils/hooks';
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { SETTINGS_KEYS } from '../../constants';

export default function TTSSettings() {
  const [ttsSpeed, setTTSSpeed] = useState(1);
  const activeLang = useActiveLanguage();
  const [currentTTSMode, setCurrentTTSMode] = useState<TTSMode>('browser');
  const [googleTTSAvailable, setGoogleTTSAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const init = () => {
      setCurrentTTSMode(getTTSMode());
      // Check if Google TTS is configured
      isGoogleTTSConfigured().then(setGoogleTTSAvailable);
      setTTSSpeed(parseFloat(localStorage.getItem(SETTINGS_KEYS.TTS_SPEED) || '1.0'));
    };

    init();
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
    <section className="panel space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Text-to-Speech</h2>
        {googleTTSAvailable !== null && (
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                googleTTSAvailable ? 'bg-green-500' : 'bg-yellow-500'
              }`}
            />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {googleTTSAvailable ? 'Google TTS Active' : 'Using Browser TTS'}
            </span>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Voice Engine
        </label>
        <p className="mb-2 text-xs text-zinc-500">
          Google Cloud has better pronunciation, browser is free
        </p>
        <div className="flex gap-2">
          <Button
            disabled={!googleTTSAvailable}
            onClick={() => handleTTSModeChanged('google')}
            variant={currentTTSMode === 'google' ? 'default' : 'secondary'}
          >
            Google Cloud
          </Button>
          <Button
            onClick={() => handleTTSModeChanged('browser')}
            variant={currentTTSMode === 'browser' ? 'default' : 'secondary'}
          >
            Browser Built-in
          </Button>
        </div>
      </div>

      <div>
        <Button onClick={testSpeaking}>Test Voice</Button>
      </div>

      <div>
        <label className="mb-2 flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <span>Speech Speed</span>
          <span className="font-mono text-zinc-500">{ttsSpeed.toFixed(1)}x</span>
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
        <div className="mt-1 flex justify-between text-xs text-zinc-500">
          <span>0.5x (Slow)</span>
          <span>1.0x</span>
          <span>1.5x (Fast)</span>
        </div>
      </div>
    </section>
  );
}
