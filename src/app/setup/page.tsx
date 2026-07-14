'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { seedStarterContent } from '@/lib/data-layer';
import { LANGUAGES, type LanguageCode } from '@/lib/languages';
import {
  getOnboardingSnapshot,
  skipOnboarding,
  startOnboarding,
  type ApproximateLevel,
  type LearnerInterest,
} from '@/lib/onboarding';
import { setLanguageInStorage } from '@/utils/storage';
import { Button } from '@/components/ui/button';

// Registry-derived (#307): every language in LANGUAGES gets a setup card —
// no hand-kept mirror to forget when a pack lands.
const languageCards: { code: LanguageCode; flag: string; native: string; name: string }[] =
  Object.values(LANGUAGES).map((lang) => ({
    code: lang.code,
    flag: lang.flag,
    native: lang.native,
    name: lang.name,
  }));

const levelOptions: Array<{ value: ApproximateLevel; label: string }> = [
  { value: 'new', label: 'Just starting' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'not_sure', label: 'Not sure' },
];

const interestOptions: Array<{ value: LearnerInterest; label: string }> = [
  { value: 'everyday-life', label: 'Everyday life' },
  { value: 'culture', label: 'Culture' },
  { value: 'current-events', label: 'Current events' },
  { value: 'literature', label: 'Literature' },
  { value: 'faith-and-theology', label: 'Faith & theology' },
  { value: 'travel', label: 'Travel' },
];

export default function SetupPage() {
  const router = useRouter();
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode | null>(null);
  const [pending, setPending] = useState<LanguageCode | null>(null);
  const [level, setLevel] = useState<ApproximateLevel>('not_sure');
  const [interests, setInterests] = useState<LearnerInterest[]>([]);
  const [dailyMinutes, setDailyMinutes] = useState(10);
  const [error, setError] = useState<string | null>(null);

  // A completed/skipped guide never reappears. An explicit visit while a guide
  // is in progress resumes its real starter lesson instead of beginning again.
  useEffect(() => {
    let cancelled = false;
    void getOnboardingSnapshot()
      .then((snapshot) => {
        if (cancelled || !snapshot.progress) return;
        if (snapshot.profile) {
          setLevel(snapshot.profile.approximateLevel);
          setInterests(snapshot.profile.interests);
          setDailyMinutes(snapshot.profile.dailyMinutes);
        }
        if (snapshot.progress.status === 'in_progress' && snapshot.progress.recommendedLessonId) {
          router.replace(`/read/${snapshot.progress.recommendedLessonId}?onboarding=1`);
        } else if (snapshot.progress.status !== 'in_progress') {
          router.replace('/');
        }
      })
      .catch(() => {
        // The language picker remains usable; selecting a language will retry
        // through the start/skip write and surface an actionable error.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  function toggleInterest(interest: LearnerInterest) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((value) => value !== interest)
        : [...current, interest],
    );
  }

  async function handleContinue(guided: boolean) {
    if (!selectedLanguage || pending) return;
    const code = selectedLanguage;
    setPending(selectedLanguage);
    setError(null);

    try {
      // Seeding is safe before the target-language write: the route accepts an
      // explicit language and is idempotent. /onboarding/start or /skip then
      // atomically persists the profile, progress and target language.
      const starter = await seedStarterContent(code);
      const profile = {
        language: code,
        approximateLevel: level,
        interests,
        dailyMinutes,
      };

      if (guided && starter.recommendedLessonId) {
        await startOnboarding({
          ...profile,
          starterCollectionId: starter.collectionId,
          recommendedLessonId: starter.recommendedLessonId,
          recommendedLessonTitle: starter.recommendedLessonTitle,
        });
        setLanguageInStorage(code);
        router.replace(`/read/${starter.recommendedLessonId}?onboarding=1`);
        return;
      }

      // Languages without a starter series take the normal library path. This
      // is recorded as skipped rather than leaving an impossible in-progress
      // guide with no lesson to resume.
      await skipOnboarding(profile);
      setLanguageInStorage(code);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your setup');
      setPending(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--primary-soft)] px-3 py-1 text-sm font-semibold text-[var(--primary-text)]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Your first reading session
          </div>
          <h1 className="mb-3 text-3xl font-bold tracking-tight text-foreground">
            Welcome to Lector
          </h1>
          <p className="mx-auto max-w-xl text-base text-muted-foreground sm:text-lg">
            Tell us just enough to choose a useful first lesson. Every answer is optional.
          </p>
        </div>

        <section aria-labelledby="language-heading" className="mb-8">
          <h2 id="language-heading" className="mb-3 text-sm font-bold text-foreground">
            1. Choose a language
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {languageCards.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => setSelectedLanguage(lang.code)}
                disabled={pending !== null}
                data-testid={`setup-language-${lang.code}`}
                aria-label={`Learn ${lang.name}`}
                aria-pressed={selectedLanguage === lang.code}
                className={`group flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 px-4 py-5 transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none ${
                  selectedLanguage === lang.code
                    ? 'border-primary bg-[var(--primary-soft)]'
                    : pending !== null
                      ? 'cursor-not-allowed border-border bg-card opacity-50'
                      : 'border-border bg-card hover:border-primary hover:shadow-md'
                }`}
              >
                <span className="text-4xl" aria-hidden="true">
                  {lang.flag}
                </span>
                <span className="text-lg font-semibold text-foreground">{lang.native}</span>
                <span className="text-xs text-muted-foreground">{lang.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="preferences-heading"
          className="mb-6 rounded-2xl border border-border bg-card p-5 sm:p-6"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 id="preferences-heading" className="text-sm font-bold text-foreground">
                2. Personalise the session
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick what feels closest. You can change direction later.
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Optional
            </span>
          </div>

          <fieldset className="mb-5">
            <legend className="mb-2 text-xs font-semibold text-muted-foreground">
              Approximate level
            </legend>
            <div className="flex flex-wrap gap-2">
              {levelOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={level === option.value}
                  onClick={() => setLevel(option.value)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    level === option.value
                      ? 'border-primary bg-[var(--primary-soft)] text-[var(--primary-text)]'
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mb-5">
            <legend className="mb-2 text-xs font-semibold text-muted-foreground">Interests</legend>
            <div className="flex flex-wrap gap-2">
              {interestOptions.map((option) => {
                const selected = interests.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleInterest(option.value)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      selected
                        ? 'border-primary bg-[var(--primary-soft)] text-[var(--primary-text)]'
                        : 'border-border bg-background text-foreground hover:bg-accent'
                    }`}
                  >
                    {selected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-muted-foreground">
              Daily reading time
            </legend>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 20, 30].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={dailyMinutes === minutes}
                  onClick={() => setDailyMinutes(minutes)}
                  className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    dailyMinutes === minutes
                      ? 'border-primary bg-[var(--primary-soft)] text-[var(--primary-text)]'
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                >
                  {minutes} min
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Ready for your first text?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The guide stays inside a real starter lesson and can be left at any time.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleContinue(false)}
                disabled={!selectedLanguage || pending !== null}
                data-testid="skip-guided-onboarding"
              >
                Skip to library
              </Button>
              <Button
                type="button"
                onClick={() => handleContinue(true)}
                disabled={!selectedLanguage || pending !== null}
                data-testid="start-guided-onboarding"
              >
                {pending ? 'Preparing lesson…' : 'Start guided lesson'}
                {!pending && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-4 text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
