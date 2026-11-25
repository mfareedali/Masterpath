import { CardListSkeleton, Skeleton } from '@/components/ui/card';

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <Skeleton className="mb-2 h-8 w-1/2" />
      <Skeleton className="mb-6 h-4 w-3/4" />
      <CardListSkeleton count={2} />
    </div>
  );
}
