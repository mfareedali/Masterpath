/**
 * Saved programs. The server sends compact summaries of every program (small, cacheable);
 * the client list shows the ones saved in localStorage 'mp_saved'. No account, works offline once cached.
 */
import type { Metadata } from 'next';
import { SavedList } from '@/components/shortlist/saved-list';
import { PageHeader } from '@/components/ui/card';
import { getInstitutionMap, getPrograms } from '@/lib/data';
import type { SavedProgramSummary } from '@/lib/shortlist/saved';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Saved programs',
  description: 'Programs you saved on this device.',
};

export default async function SavedPage() {
  const [programs, institutions] = await Promise.all([getPrograms(), getInstitutionMap()]);
  const summaries: SavedProgramSummary[] = programs.map((p) => ({
    id: p.id,
    name: p.name,
    institutionName: institutions.get(p.institution_id)?.name ?? p.institution_id,
    country: p.country,
    status: p.status,
  }));

  return (
    <div>
      <PageHeader title="Saved programs" subtitle="Saved on this phone only. No account needed." />
      <SavedList programs={summaries} />
    </div>
  );
}
