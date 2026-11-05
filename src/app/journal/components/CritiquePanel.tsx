import type { JournalCritique } from '@/lib/data-layer';

export default function CritiquePanel({ critique }: { critique: JournalCritique | null }) {
  if (!critique) {
    return (
      <div className="px-5 py-6 font-reading text-base leading-8 text-muted-foreground">
        This page has no critique. A new correction writes one.
      </div>
    );
  }

  return (
    <div className="grid gap-6 px-5 py-6 sm:grid-cols-2">
      <section>
        <h3 className="mb-3 text-xs font-medium tracking-wide text-primary uppercase">Strengths</h3>
        <ul className="space-y-3">
          {critique.strengths.map((item, index) => (
            <li key={index} className="font-reading text-base leading-8 text-foreground">
              {item}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-3 text-xs font-medium tracking-wide text-clay uppercase">Weak points</h3>
        <ul className="space-y-3">
          {critique.weaknesses.map((item, index) => (
            <li key={index} className="font-reading text-base leading-8 text-foreground">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
