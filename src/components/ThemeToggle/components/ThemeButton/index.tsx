import clsx from 'clsx';
import { IThemeButtonProps } from './types';

export default function ThemeButton({
  icon: Icon,
  theme,
  value,
  label,
  onClick,
}: IThemeButtonProps) {
  const isActive = theme === value;

  const handleOptionClicked = () => {
    onClick(value);
  };

  return (
    <button
      key={value}
      type="button"
      onClick={handleOptionClicked}
      title={label}
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
