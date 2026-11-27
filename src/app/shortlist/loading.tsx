import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function ShortlistLoading() {
  return <PageSkeleton cards={4} filters />;
}
