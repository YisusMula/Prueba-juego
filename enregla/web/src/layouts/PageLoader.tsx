import { Skeleton } from '@/components/ui/Feedback';

export function PageLoader() {
  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
      <span className="sr-only">Cargando…</span>
      <Skeleton className="h-10 w-2/3 max-w-sm" />
      <Skeleton className="h-5 w-1/2 max-w-xs" />
      <div className="grid gap-3 pt-4 sm:grid-cols-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}
