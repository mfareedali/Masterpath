import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function ProgramNotFound() {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <h1 className="text-2xl font-bold">Program not found</h1>
        <p className="mt-2 text-base text-ink">
          We could not find this program. It may have been renamed or removed. Your shortlist shows all programs we track.
        </p>
        <ButtonLink href="/shortlist" className="mt-4">
          Go to your shortlist
        </ButtonLink>
      </Card>
    </div>
  );
}
