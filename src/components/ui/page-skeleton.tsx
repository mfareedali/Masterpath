import { CardListSkeleton, Skeleton } from './card';

/** Loading placeholder with the same shape as a page: journey cue, title, purpose line, one action, a card list. */
export function PageSkeleton({ cards = 3, filters = false }: { cards?: number; filters?: boolean }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-5 w-3/4" />
      <Skeleton className="mb-2 h-8 w-2/3" />
      <Skeleton className="mb-4 h-4 w-full" />
      {filters ? (
        <div className="mb-4 flex gap-2" aria-hidden="true">
          <Skeleton className="h-tap w-24" />
          <Skeleton className="h-tap w-28" />
          <Skeleton className="h-tap w-20" />
        </div>
      ) : null}
      <CardListSkeleton count={cards} />
    </div>
  );
}
