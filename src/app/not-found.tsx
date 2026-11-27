import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <h1 className="text-2xl font-bold">We could not find that page</h1>
        <p className="mt-2 text-ink">The link may be old or mistyped. Start from your shortlist or the home page.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ButtonLink href="/shortlist">Go to your shortlist</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Home
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
