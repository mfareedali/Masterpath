/**
 * Example claims that prefill the Consultant Check form. They are MADE UP for the demo: they show the kind
 * of thing students are told. They are not statements about any real agent, and they are not facts.
 * What MastersPath says about them comes only from the data rows.
 */
export interface ExampleClaim {
  id: string;
  label: string;
  text: string;
}

export const EXAMPLE_CLAIMS: readonly ExampleClaim[] = [
  {
    id: 'uk',
    label: 'UK promise',
    text: 'Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in 2 years.',
  },
  {
    id: 'germany',
    label: 'Germany promise',
    text: 'TUM accepts 2.5 CGPA. Tuition is free in Germany. Deadline is 31 May. German passport in 3 years.',
  },
  {
    id: 'usa',
    label: 'USA promise',
    text: '100% visa guaranteed for USA. Full scholarship confirmed at USF. Post-study work 3 years. Only 2 seats left so pay today.',
  },
];

export function findExample(id: string | null | undefined): ExampleClaim | null {
  if (!id) return null;
  return EXAMPLE_CLAIMS.find((e) => e.id === id) ?? null;
}
