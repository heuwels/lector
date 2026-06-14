import Link from 'next/link';
import Image from 'next/image';

export default function AppName() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Image src="/logo.svg" alt="Lector" width={28} height={28} className="rounded" />
      <span className="text-md font-bold tracking-tight text-zinc-900 sm:text-lg dark:text-zinc-50">
        Lector
      </span>
    </Link>
  );
}
