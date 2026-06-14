import { Button } from '@/components/ui/button';
import { getSetting, setSetting } from '@/lib/data-layer';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function Timezone() {
  // Time zone state (server-side setting — drives day rollover for daily
  // stats, streaks and review days; issue #108)
  const [timezone, setTimezone] = useState<string>('');
  const [timezones, setTimezones] = useState<string[]>([]);
  const [browserTimeZone, setBrowserTimeZone] = useState<string>('');

  // Load settings from localStorage on mount
  useEffect(() => {
    const init = () => {
      // Time zone: populate the IANA list and the saved value
      setBrowserTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      const intlWithSupported = Intl as typeof Intl & {
        supportedValuesOf?: (key: 'timeZone') => string[];
      };
      setTimezones(
        intlWithSupported.supportedValuesOf ? intlWithSupported.supportedValuesOf('timeZone') : [],
      );
      getSetting<string>('timezone').then((tz) => {
        if (tz) setTimezone(tz);
      });
    };

    init();
  }, []);

  // Save the day-rollover time zone ('' = auto, server's zone)
  const saveTimezone = async (tz: string) => {
    setTimezone(tz);
    try {
      await setSetting('timezone', tz);
      toast.success(`Timezone updated to ${tz}`);
    } catch (e) {
      console.error(e);
      toast.error('Failed to change timezone');
    }
  };

  return (
    <section className="panel p-6">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Time Zone</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Daily stats, streaks and review days roll over at midnight in this time zone.
      </p>
      <select
        value={timezone}
        onChange={(e) => saveTimezone(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none "
      >
        <option value="">Auto — server time zone</option>
        {timezones.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>
      {browserTimeZone && timezone !== browserTimeZone && (
        <Button variant="link" onClick={() => saveTimezone(browserTimeZone)} className="mt-3">
          Use this device&apos;s time zone ({browserTimeZone})
        </Button>
      )}
    </section>
  );
}
