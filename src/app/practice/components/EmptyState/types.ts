import { type RoundType } from '../../types';

export interface IEmptyStateProps {
  onBackPressed: () => void;
  onLearnNewPressed: () => void;
  roundType: RoundType;
}
