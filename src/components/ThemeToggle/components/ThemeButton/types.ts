import { Theme } from '@/types/theme';
import { IThemeOption } from '../../types';

export interface IThemeButtonProps extends IThemeOption {
  onClick: (theme: Theme) => void;
  theme: Theme;
}
