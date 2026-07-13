'use client';
import { Volume2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ClozeFeedback from '@/components/ClozeFeedback';
import { splitTrailingPunctuation } from '@/lib/words';
import { addClozeCard } from '@/lib/anki';
import { queueForAnki } from '@/lib/anki-queue';
import { useAnkiTransport } from '@/lib/anki-transport';
import { foldWord } from '@/lib/languages';
import { getVocabByText, saveVocab } from '@/lib/data-layer';
import { ANKI_CLOZE_DECK_SETTING_KEY } from '../../constants';
import { CurrentSentence, IFeedbackData } from '../../types';
import { isTTSAvailable, speak } from '@/lib/tts';
import { useActiveLanguage } from '@/utils/hooks';

export default function Feedback({
  feedbackData,
  current,
  onWordClicked,
  onNext,
}: {
  feedbackData: IFeedbackData | null;
  current: CurrentSentence | null;
  onWordClicked: (word: string) => void;
  onNext: () => void;
}) {
  const activeLang = useActiveLanguage();
  const ankiTransport = useAnkiTransport();
  const [isAddingToAnki, setIsAddingToAnki] = useState(false);
  const [ankiAdded, setAnkiAdded] = useState(false);

  const handleNextButtonPressed = () => {
    setAnkiAdded(false);
    onNext();
  };

  // Handle add to Anki
  const handleAddToAnki = async () => {
    if (!current || !feedbackData || !feedbackData.isCorrect || isAddingToAnki || ankiAdded) {
      return;
    }

    setIsAddingToAnki(true);
    try {
      const deckName =
        localStorage.getItem(ANKI_CLOZE_DECK_SETTING_KEY) || `${activeLang.native}::Cloze`;

      const cleanWord = splitTrailingPunctuation(current.sentence.clozeWord)[0];

      // Addon transport (#241): the queue is keyed on vocab entries, so
      // resolve the practiced word to one (creating a level1 entry when it's
      // a bank word that was never saved — it's being studied, so it belongs
      // in vocab) and queue the cloze with THIS sentence as an override.
      if (ankiTransport === 'addon') {
        let entry = await getVocabByText(foldWord(cleanWord, activeLang));
        if (!entry) {
          const now = new Date();
          entry = {
            id: crypto.randomUUID(),
            text: foldWord(cleanWord, activeLang),
            type: 'word',
            sentence: current.sentence.sentence,
            translation: current.sentence.translation,
            state: 'level1',
            stateUpdatedAt: now,
            reviewCount: 0,
            createdAt: now,
            pushedToAnki: false,
          };
          if ((await saveVocab(entry)) === null) {
            throw new Error('Could not save the word to vocabulary');
          }
        }
        const result = await queueForAnki([
          {
            id: entry.id,
            cardType: 'cloze',
            word: cleanWord,
            sentence: current.sentence.sentence,
            translation: current.sentence.translation,
            meaning: cleanWord,
          },
        ]);
        if (result.failed.length > 0) throw new Error(result.failed[0].error);
        setAnkiAdded(true);
        return;
      }

      await addClozeCard(
        deckName,
        current.sentence.sentence,
        cleanWord,
        current.sentence.translation,
        cleanWord,
      );
      setAnkiAdded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add to Anki';
      toast.error(message);
    } finally {
      setIsAddingToAnki(false);
    }
  };

  const handleSpeak = () => {
    if (!current) return;
    speak(current.sentence.sentence);
  };

  if (!feedbackData) {
    return;
  }

  return (
    <div>
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            {feedbackData.isCorrect ? 'Correct!' : 'Incorrect'}
          </span>
          {isTTSAvailable() && feedbackData.isCorrect && (
            <Button type="button" onClick={handleSpeak} variant="ghost">
              <Volume2 className="h-4 w-4" />
              Listen Again
            </Button>
          )}
        </div>
        <p className="text-xl leading-relaxed font-medium text-foreground">
          {current &&
            current.sentence.sentence.split(/\s+/).map((word, i) => (
              <span key={i}>
                {i > 0 && ' '}
                {i === current.sentence.clozeIndex ? (
                  // Keep trailing punctuation outside the highlighted chip so a
                  // sentence-final answer ("vriende.") doesn't show the period
                  // inside the coloured box — matching the question screen.
                  (() => {
                    const [base, punct] = splitTrailingPunctuation(word);
                    return (
                      <>
                        <button
                          type="button"
                          data-testid="cloze-word"
                          onClick={() => onWordClicked(base)}
                          aria-label={`Look up ${base}`}
                          className={`inline cursor-pointer rounded px-1 font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                            feedbackData.isCorrect
                              ? 'border border-primary bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary'
                              : 'border border-destructive bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive'
                          }`}
                        >
                          {base}
                        </button>
                        {punct}
                      </>
                    );
                  })()
                ) : (
                  <button
                    type="button"
                    data-testid="cloze-word"
                    onClick={() => onWordClicked(word)}
                    aria-label={`Look up ${splitTrailingPunctuation(word)[0]}`}
                    className="inline cursor-pointer rounded px-0.5 font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {word}
                  </button>
                )}
              </span>
            ))}
        </p>
        <p className="mt-2 text-base text-muted-foreground italic">
          {current && current.sentence.translation}
        </p>
      </div>

      <ClozeFeedback
        isCorrect={feedbackData.isCorrect}
        correctWord={feedbackData.correctWord}
        userAnswer={feedbackData.userAnswer}
        translation={feedbackData.translation}
        sentence={current ? current.sentence.sentence : ''}
        points={feedbackData.points}
        newMastery={feedbackData.newMastery}
        previousMastery={feedbackData.previousMastery}
        onNext={handleNextButtonPressed}
        onAddToAnki={handleAddToAnki}
        isAddingToAnki={isAddingToAnki}
        ankiAdded={ankiAdded}
      />
    </div>
  );
}
