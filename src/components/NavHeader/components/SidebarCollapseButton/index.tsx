import { ChevronsLeft, ChevronsRight } from 'lucide-react';

export default function SidebarCollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;

  return (
    <button
      type="button"
      data-testid="sidebar-collapse"
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon size={16} />
    </button>
  );
}
