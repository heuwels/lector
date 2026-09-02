export interface IOnboardingTipProps {
  title: string;
  body: string;
  onDismiss: () => void;
  className?: string;
  testId: string;
}
