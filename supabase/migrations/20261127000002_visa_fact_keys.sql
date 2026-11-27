-- Visa details as country facts: three new keys (visa_fee, visa_processing_time, student_work_rights).
-- Same evidence rules as every other fact: value + source_url + evidence_snippet + fetched_at, confidence computed on read.
-- proof_of_funds (visa money) and post_study_work already exist. No new table: country_facts already has the evidence columns,
-- RLS, the computed-confidence view and the seed upsert. Idempotent: safe to run twice.

alter table public.country_facts drop constraint if exists country_facts_key_check;
alter table public.country_facts add constraint country_facts_key_check check (
  key in (
    'citizenship_rule', 'citizenship_update', 'dual_nationality_destination', 'post_study_work',
    'pr_route', 'pakistan_dual_nationality', 'tuition_typical', 'living_cost_typical', 'proof_of_funds',
    'visa_fee', 'visa_processing_time', 'student_work_rights'
  )
);
