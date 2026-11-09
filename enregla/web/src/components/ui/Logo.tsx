import { APP_NAME } from '@/config/brand';
import { cn } from '@/lib/cn';

/** Marca: una placa de cocina con un tic que termina en bulbo de termómetro. */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="var(--brand)" />
      <path d="M12 25.5l7.5 7.5L35 15" fill="none" stroke="var(--on-brand)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35" cy="15" r="4.2" fill="var(--mint)" stroke="var(--on-brand)" strokeWidth="2.5" />
    </svg>
  );
}

export function Logo({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span className="font-display text-[1.35rem] font-extrabold tracking-tight">{APP_NAME}</span>
    </span>
  );
}
