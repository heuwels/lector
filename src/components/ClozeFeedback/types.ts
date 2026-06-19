export interface ClozeFeedbackProps {
  isCorrect: boolean;
  correctWord: string;
  userAnswer: string;
  translation: string;
  sentence: string;
  points: number;
  newMastery: number;
  previousMastery: number;
  onNext: () => void;
  onAddToAnki: () => void;
  isAddingToAnki?: boolean;
  ankiAdded?: boolean;
}
