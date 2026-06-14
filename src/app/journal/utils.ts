export function formatDate(dateStr: string) {
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(isoStr: string) {
  const d = new Date(isoStr);
  return (
    d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  );
}
