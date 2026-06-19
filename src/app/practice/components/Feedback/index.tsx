'use client';
import { Volume2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ClozeFeedback from '@/components/ClozeFeedback';
import { splitTrailingPunctuation } from '@/lib/words';
import { addClozeCard } from '@/lib/anki';
import { ANKI_CLOZE_DECK_SETTING_KEY, DEFAULT_ANKI_CLOZE_DECK } from '../../constants';
import { CurrentSentence, IFeedbackData } from '../../types';
import { isTTSAvailable, speak } from '@/lib/tts';

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
      const deckName = localStorage.getItem(ANKI_CLOZE_DECK_SETTING_KEY) || DEFAULT_ANKI_CLOZE_DECK;

      const cleanWord = splitTrailingPunctuation(current.sentence.clozeWord)[0];
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
                  <span
                    data-testid="cloze-word"
                    onClick={() => onWordClicked(word)}
                    className={`cursor-pointer rounded px-1 font-bold ${
                      feedbackData.isCorrect
                        ? 'border border-primary bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary'
                        : 'border border-destructive bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive'
                    }`}
                  >
                    {word}
                  </span>
                ) : (
                  <span
                    data-testid="cloze-word"
                    onClick={() => onWordClicked(word)}
                    className="cursor-pointer rounded px-0.5 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {word}
                  </span>
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
