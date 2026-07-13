export function lookupAnnouncement({
  isOpen,
  word,
  isLoading,
  error,
  hasResult,
}: {
  isOpen: boolean;
  word: string;
  isLoading: boolean;
  error?: string | null;
  hasResult: boolean;
}): string {
  if (!isOpen || !word) return '';
  if (isLoading) return `Looking up ${word}.`;
  if (error) return `Lookup failed for ${word}. ${error}`;
  if (hasResult) return `Definition loaded for ${word}.`;
  return `No definition found for ${word}.`;
}
