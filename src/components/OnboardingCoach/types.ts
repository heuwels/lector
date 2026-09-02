export type OnboardingCoachStage = 'lookup' | 'phrase' | 'save' | 'practice';

export interface IOnboardingCoachProps {
  stage: OnboardingCoachStage;
  savedCount: number;
  savedWords: string[];
  onStartPractice?: () => void;
}
