import Link from 'next/link';
import Image from 'next/image';
import type { IAppNameProps } from './types';

export default function AppName({ hideName = false }: IAppNameProps) {
  return (
    <Link href="/" className="flex items-center gap-2" title="Lector">
      <Image src="/logo.svg" alt="Lector" width={28} height={28} className="rounded" />
      {!hideName && (
        <span
          data-testid="app-name-label"
          className="text-md font-extrabold tracking-tight text-foreground sm:text-lg"
        >
          Lector
        </span>
      )}
    </Link>
  );
}
