import { IPageHeaderProps } from './types';

export default function PageHeader({ children, title }: IPageHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{title}</h1>
      {children}
    </div>
  );
}
