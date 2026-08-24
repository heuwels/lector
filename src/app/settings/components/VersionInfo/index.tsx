'use client';

import { type ReactNode, useEffect, useState } from 'react';
import {
  buildInfo,
  commitShort,
  commitUrl,
  formatBuildTime,
  formatBuildVersion,
  isKnown,
  relativeBuildAge,
} from '@/lib/build-info';

function Row({
  label,
  mono = true,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right text-foreground ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}

export default function VersionInfo() {
  const { version, commit, buildTime } = buildInfo;
  const href = commitUrl(commit);
  const built = formatBuildTime(buildTime);

  // Relative age depends on the current time, so compute it after mount — this
  // keeps it out of the server-rendered HTML and avoids a hydration mismatch.
  const [age, setAge] = useState('');
  useEffect(() => {
    setAge(relativeBuildAge(buildTime, Date.now()));
  }, [buildTime]);

  return (
    <section className="panel p-6">
      <h2 className="mb-4 text-lg font-semibold text-foreground">About</h2>
      <dl className="space-y-3 text-sm">
        {/*
          "Build", not "Version", because one row covers two cases. A release
          image reads as the tag exactly, e.g. "v3.10.0". A cloud deploy goes
          out by commit SHA, so it reads as "v3.10.0 +3".
        */}
        <Row label="Build">{formatBuildVersion(version)}</Row>
        {isKnown(commit) && (
          <Row label="Commit">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {commitShort(commit)}
              </a>
            ) : (
              commitShort(commit)
            )}
          </Row>
        )}
        {built && (
          <Row label="Built" mono={false}>
            {built}
            {age && <span className="text-muted-foreground"> ({age})</span>}
          </Row>
        )}
      </dl>
    </section>
  );
}
