import Link from 'next/link';
import Image from 'next/image';

export default function AppName() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Image src="/logo.svg" alt="Lector" width={28} height={28} className="rounded" />
      <span className="text-md font-extrabold tracking-tight text-foreground sm:text-lg">
        Lector
      </span>
    </Link>
  );
}
