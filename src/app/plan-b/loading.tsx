import { CardListSkeleton, Skeleton } from '@/components/ui/card';

export default function PlanBLoading() {
  return (
    <div>
      <Skeleton className="mb-2 h-8 w-2/3" />
      <Skeleton className="mb-4 h-4 w-full" />
      <Skeleton className="mb-4 h-20 w-full" />
      <div className="chip-row mb-4" aria-hidden="true">
        <Skeleton className="h-tap w-32" />
        <Skeleton className="h-tap w-28" />
        <Skeleton className="h-tap w-36" />
      </div>
      <CardListSkeleton count={3} />
    </div>
  );
}
