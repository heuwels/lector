import clsx from 'clsx';
import { useTheme } from '@/utils/hooks';
import { IThemeOption } from '../../types';

export default function ThemeButton(opt: IThemeOption) {
  const { theme, setTheme } = useTheme();

  const Icon = opt.icon;
  const isActive = theme === opt.value;

  const handleOptionClicked = () => {
    setTheme(opt.value);
  };

  return (
    <button
      key={opt.value}
      type="button"
      onClick={handleOptionClicked}
      title={opt.label}
      className={clsx(
        'rounded-md p-1.5 transition-colors',
        isActive
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon size="14" />
    </button>
  );
}
