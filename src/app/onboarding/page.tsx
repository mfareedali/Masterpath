import type { Metadata } from 'next';
import { Onboarding } from '@/components/onboarding/onboarding-form';
import { PageHeader } from '@/components/ui/card';
import { getFieldsWithPrograms, getInstitutions } from '@/lib/data';
import { homeUniversityOptions } from '@/lib/onboarding/university';

export const metadata: Metadata = {
  title: 'Your profile',
  description: 'Tell MastersPath your grade, field, budget and target countries. About a minute. Saved only on your device.',
};

// The university list comes from the dataset; refresh it hourly.
export const revalidate = 3600;

export default async function OnboardingPage() {
  const [universities, fieldsWithPrograms] = await Promise.all([
    getInstitutions().then(homeUniversityOptions),
    getFieldsWithPrograms(),
  ]);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Your profile" subtitle="About a minute. Only your grade is required; the rest helps us sort your options." />
      <Onboarding universities={universities} fieldsWithPrograms={fieldsWithPrograms} />
    </div>
  );
}
