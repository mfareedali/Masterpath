import { CardListSkeleton, Skeleton } from '@/components/ui/card';

export default function OnboardingLoading() {
  return (
    <div className="mx-auto max-w-xl">
      <Skeleton className="mb-2 h-8 w-1/2" />
      <Skeleton className="mb-6 h-4 w-3/4" />
      <CardListSkeleton count={3} />
    </div>
  );
}
