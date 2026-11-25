-- MastersPath initial schema.
--
-- Rules this schema enforces:
--   * Every program / institution fact is ONE jsonb column shaped like
--       { "value": ..., "source_url": ..., "evidence_snippet": ..., "fetched_at": ...,
--         "basis"?: "verbatim" | "summary" | "inferred", "note"?: ..., "conflicts"?: [ ...sources ] }
--     A null value means "Not verified yet". CHECK constraints (fact_is_well_formed) reject facts whose
--     evidence snippet has no source URL, and source URLs that are not http(s).
--   * Confidence (Verified / Likely / Unverified / Conflict) is COMPUTED IN APP CODE (src/lib/confidence.ts).
--     country_facts.confidence is only a convenience cache for SQL dashboards; the app never reads it.
--   * Row level security is enabled on EVERY table. Public data is read-only for anon/authenticated.
--     Personal data (profiles, profile_strengths) is visible only to its owner (auth.uid() = user_id).
--   * Personal data is minimal: grades, field, budget, target countries, strengths. There are no
--     identity-document columns, and there must never be any.
--   * Hard delete: the API route POST /api/account/delete verifies the session, then calls
--     auth.admin.deleteUser(user.id) with the service-role key. Deleting the auth.users row cascades
--     (on delete cascade) to profiles and profile_strengths, so nothing personal is left behind.

-- ---------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------

-- One source of a fact: an object with a "value" key; optional string fields; a snippet needs a URL.
create or replace function public.source_is_well_formed(s jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(s) = 'object'
    and (s -> 'value') is not null
    and coalesce(jsonb_typeof(s -> 'source_url'), 'null') in ('string', 'null')
    and coalesce(jsonb_typeof(s -> 'evidence_snippet'), 'null') in ('string', 'null')
    and coalesce(jsonb_typeof(s -> 'fetched_at'), 'null') in ('string', 'null')
    and coalesce(jsonb_typeof(s -> 'note'), 'null') in ('string', 'null')
    and coalesce(jsonb_typeof(s -> 'basis'), 'null') in ('string', 'null')
    -- a non-empty evidence snippet requires a non-empty source URL
    and (
      nullif(btrim(s ->> 'evidence_snippet'), '') is null
      or nullif(btrim(s ->> 'source_url'), '') is not null
    )
    -- links are only ever http(s)
    and (s ->> 'source_url' is null or s ->> 'source_url' ~* '^https?://')
    and (s ->> 'fetched_at' is null or s ->> 'fetched_at' ~ '^\d{4}-\d{2}-\d{2}')
    and (s ->> 'basis' is null or s ->> 'basis' in ('verbatim', 'summary', 'inferred')),
    false
  );
$$;

-- A list of other sources (the "conflicts" array): null, or an array of well-formed sources.
create or replace function public.sources_are_well_formed(arr jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when arr is null or jsonb_typeof(arr) = 'null' then true
    when jsonb_typeof(arr) <> 'array' then false
    else not exists (
      select 1
      from jsonb_array_elements(arr) as c(s)
      where not public.source_is_well_formed(c.s)
    )
  end;
$$;

-- A full fact: a well-formed primary source plus well-formed conflicting sources.
create or replace function public.fact_is_well_formed(f jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    public.source_is_well_formed(f) and public.sources_are_well_formed(f -> 'conflicts'),
    false
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Public, read-only data (written only by the service role, e.g. scripts/seed-supabase.ts)
-- ---------------------------------------------------------------------------------------------------

create table if not exists public.institutions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null check (char_length(name) between 1 and 200),
  country text not null check (char_length(country) between 2 and 3),
  kind text not null check (kind in ('destination', 'home')),
  website text check (website is null or website ~* '^https?://'),
  hec_status jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(hec_status)),
  pqr_status jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(pqr_status)),
  anabin_status jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(anabin_status)),
  recognition_list_status jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(recognition_list_status)),
  notes text check (notes is null or char_length(notes) <= 2000),
  updated_at timestamptz not null default now()
);

create table if not exists public.programs (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  institution_id text not null references public.institutions (id) on update cascade on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  country text not null check (char_length(country) between 2 and 3),
  degree text not null check (char_length(degree) between 1 and 80),
  field text not null check (char_length(field) between 1 and 40),
  official_url text check (official_url is null or official_url ~* '^https?://'),
  status text not null default 'active' check (status in ('active', 'ruled_out')),
  pathway_type text not null default 'direct'
    check (pathway_type in ('direct', 'conditional', 'pre_masters', 'pathway', 'score_based', 'research_led')),
  -- One jsonb column per fact field of the Program type (src/lib/types.ts).
  status_note jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(status_note)),
  intake jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(intake)),
  deadline jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(deadline)),
  min_gpa_rule jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(min_gpa_rule)),
  language_req jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(language_req)),
  tuition jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(tuition)),
  living_cost jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(living_cost)),
  duration_months jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(duration_months)),
  scholarship_info jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(scholarship_info)),
  sop_requirements jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(sop_requirements)),
  lor_count jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(lor_count)),
  cv_requirements jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(cv_requirements)),
  tests_required jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(tests_required)),
  research_considered jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(research_considered)),
  progression_guaranteed jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(progression_guaranteed)),
  progression_requirement jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(progression_requirement)),
  -- Who the programme is for, as the official page states it (shown as a warning; never decides fit).
  eligibility_note jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(eligibility_note)),
  -- Official conditional/provisional route below the regular minimum.
  conditional_admission jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(conditional_admission)),
  -- Whether the English test can be waived for a Pakistani degree, as the official page states it.
  language_waiver jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(language_waiver)),
  admissions_email jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(admissions_email)),
  last_checked date,
  updated_at timestamptz not null default now()
);

create index if not exists programs_institution_id_idx on public.programs (institution_id);
create index if not exists programs_country_idx on public.programs (country);

create table if not exists public.country_facts (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  country text not null check (char_length(country) between 2 and 3),
  key text not null check (
    key in (
      'citizenship_rule', 'citizenship_update', 'dual_nationality_destination', 'post_study_work',
      'pr_route', 'pakistan_dual_nationality', 'tuition_typical', 'living_cost_typical', 'proof_of_funds'
    )
  ),
  -- { "text": ..., "sort_months"?: ..., "money"?: {...}, "clock_note"?: ... } or null (Not verified yet)
  value jsonb check (
    value is null
    or jsonb_typeof(value) = 'null'
    or (jsonb_typeof(value) = 'object' and jsonb_typeof(value -> 'text') = 'string')
  ),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  evidence_snippet text,
  fetched_at timestamptz,
  basis text check (basis is null or basis in ('verbatim', 'summary', 'inferred')),
  note text check (note is null or char_length(note) <= 2000),
  -- Internal reviewer note (provenance). Never shown to students.
  review_note text check (review_note is null or char_length(review_note) <= 4000),
  conflicts jsonb check (public.sources_are_well_formed(conflicts)),
  -- CACHE ONLY, filled by the seed script for SQL dashboards. The app always recomputes confidence in code
  -- with computeConfidence(fact, now) and never reads this column.
  confidence text check (confidence is null or confidence in ('Verified', 'Likely', 'Unverified', 'Conflict')),
  updated_at timestamptz not null default now(),
  constraint country_facts_country_key_unique unique (country, key),
  constraint country_facts_snippet_needs_source check (
    nullif(btrim(evidence_snippet), '') is null or nullif(btrim(source_url), '') is not null
  )
);

comment on column public.country_facts.confidence is
  'Cache only. The app computes confidence in code (src/lib/confidence.ts) and never reads this column.';

create table if not exists public.conversion_rules (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  scope text not null check (char_length(scope) between 1 and 40),
  from_scale text not null check (from_scale in ('cgpa_4', 'cgpa_5', 'percent', 'german')),
  to_scale text not null check (to_scale in ('cgpa_4', 'cgpa_5', 'percent', 'german')),
  formula text not null check (formula in ('identity', 'modified_bavarian', 'linear')),
  params jsonb check (params is null or jsonb_typeof(params) in ('object', 'null')),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  evidence_snippet text,
  fetched_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 2000),
  updated_at timestamptz not null default now(),
  constraint conversion_rules_snippet_needs_source check (
    nullif(btrim(evidence_snippet), '') is null or nullif(btrim(source_url), '') is not null
  )
);

create table if not exists public.fx_rates (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  currency text not null unique check (currency ~ '^[A-Z]{3}$'),
  pkr_per_unit jsonb not null default '{"value":null,"source_url":null,"evidence_snippet":null,"fetched_at":null}'::jsonb
    check (public.fact_is_well_formed(pkr_per_unit)),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------
-- Personal data (optional accounts). Owner-only. Deleted with the auth user (on delete cascade).
-- ---------------------------------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cgpa numeric not null check (cgpa >= 0 and cgpa <= 100),
  scale text not null check (scale in ('cgpa_4', 'cgpa_5', 'percent')),
  min_pass numeric check (min_pass is null or (min_pass >= 0 and min_pass <= 100)),
  university_id text check (university_id is null or char_length(university_id) <= 80),
  university_name text check (university_name is null or char_length(university_name) <= 120),
  degree text check (degree is null or char_length(degree) <= 80),
  field text not null default 'cs' check (char_length(field) between 1 and 40),
  budget_pkr numeric check (budget_pkr is null or (budget_pkr >= 0 and budget_pkr <= 1000000000)),
  target_countries text[] not null default '{}' check (cardinality(target_countries) <= 10),
  updated_at timestamptz not null default now(),
  constraint profiles_cgpa_within_scale check (
    (scale = 'cgpa_4' and cgpa <= 4) or (scale = 'cgpa_5' and cgpa <= 5) or (scale = 'percent' and cgpa <= 100)
  )
);

create table if not exists public.profile_strengths (
  user_id uuid primary key references auth.users (id) on delete cascade,
  publications jsonb not null default '[]'::jsonb check (jsonb_typeof(publications) = 'array'),
  research jsonb not null default '[]'::jsonb check (jsonb_typeof(research) = 'array'),
  collaborators jsonb not null default '[]'::jsonb check (jsonb_typeof(collaborators) = 'array'),
  code_data_links jsonb not null default '[]'::jsonb check (jsonb_typeof(code_data_links) = 'array'),
  other jsonb not null default '[]'::jsonb check (jsonb_typeof(other) = 'array'),
  free_text text check (free_text is null or char_length(free_text) <= 4000),
  updated_at timestamptz not null default now(),
  constraint profile_strengths_size_limit check (
    octet_length(publications::text) + octet_length(research::text) + octet_length(collaborators::text)
      + octet_length(code_data_links::text) + octet_length(other::text) <= 100000
  )
);

-- ---------------------------------------------------------------------------------------------------
-- Data reports ("this value looks wrong"). Service role only: /api/report validates and inserts them.
-- ---------------------------------------------------------------------------------------------------

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  program_id text references public.programs (id) on update cascade on delete set null,
  field text not null check (char_length(field) between 1 and 64),
  message text not null check (char_length(message) between 10 and 1000),
  status text not null default 'open' check (status in ('open', 'triaged', 'fixed', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists reports_program_id_idx on public.reports (program_id);

-- ---------------------------------------------------------------------------------------------------
-- Chat budgets. client_id is a HASHED client id (never a raw IP). Service role only.
-- ---------------------------------------------------------------------------------------------------

create table if not exists public.chat_usage (
  client_id text not null check (char_length(client_id) between 1 and 128),
  day date not null,
  output_tokens integer not null default 0 check (output_tokens >= 0),
  primary key (client_id, day)
);

-- Atomically adds tokens to today's budget row and returns the new total (service role only).
create or replace function public.add_chat_usage(p_client_id text, p_day date, p_tokens integer)
returns integer
language sql
security invoker
set search_path = ''
as $$
  insert into public.chat_usage as u (client_id, day, output_tokens)
  values (p_client_id, p_day, greatest(coalesce(p_tokens, 0), 0))
  on conflict (client_id, day)
  do update set output_tokens = u.output_tokens + excluded.output_tokens
  returning u.output_tokens;
$$;

-- ---------------------------------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------------------------------

drop trigger if exists institutions_set_updated_at on public.institutions;
create trigger institutions_set_updated_at before update on public.institutions
  for each row execute function public.set_updated_at();

drop trigger if exists programs_set_updated_at on public.programs;
create trigger programs_set_updated_at before update on public.programs
  for each row execute function public.set_updated_at();

drop trigger if exists country_facts_set_updated_at on public.country_facts;
create trigger country_facts_set_updated_at before update on public.country_facts
  for each row execute function public.set_updated_at();

drop trigger if exists conversion_rules_set_updated_at on public.conversion_rules;
create trigger conversion_rules_set_updated_at before update on public.conversion_rules
  for each row execute function public.set_updated_at();

drop trigger if exists fx_rates_set_updated_at on public.fx_rates;
create trigger fx_rates_set_updated_at before update on public.fx_rates
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists profile_strengths_set_updated_at on public.profile_strengths;
create trigger profile_strengths_set_updated_at before update on public.profile_strengths
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------
-- Row level security: enabled on ALL tables.
-- ---------------------------------------------------------------------------------------------------

alter table public.institutions enable row level security;
alter table public.programs enable row level security;
alter table public.country_facts enable row level security;
alter table public.conversion_rules enable row level security;
alter table public.fx_rates enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_strengths enable row level security;
alter table public.reports enable row level security;
alter table public.chat_usage enable row level security;

-- Public data: anyone can read, nobody but the service role can write (no write policies + revoked grants).
revoke all on public.institutions, public.programs, public.country_facts,
  public.conversion_rules, public.fx_rates from anon, authenticated;
grant select on public.institutions, public.programs, public.country_facts, public.conversion_rules,
  public.fx_rates to anon, authenticated;

drop policy if exists "Public read" on public.institutions;
create policy "Public read" on public.institutions for select to anon, authenticated using (true);

drop policy if exists "Public read" on public.programs;
create policy "Public read" on public.programs for select to anon, authenticated using (true);

drop policy if exists "Public read" on public.country_facts;
create policy "Public read" on public.country_facts for select to anon, authenticated using (true);

drop policy if exists "Public read" on public.conversion_rules;
create policy "Public read" on public.conversion_rules for select to anon, authenticated using (true);

drop policy if exists "Public read" on public.fx_rates;
create policy "Public read" on public.fx_rates for select to anon, authenticated using (true);

-- profiles: the signed-in owner only. anon gets nothing.
revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

drop policy if exists "Owner can read" on public.profiles;
create policy "Owner can read" on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owner can insert" on public.profiles;
create policy "Owner can insert" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owner can update" on public.profiles;
create policy "Owner can update" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owner can delete" on public.profiles;
create policy "Owner can delete" on public.profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

-- profile_strengths: the signed-in owner only. anon gets nothing.
revoke all on public.profile_strengths from anon, authenticated;
grant select, insert, update, delete on public.profile_strengths to authenticated;

drop policy if exists "Owner can read" on public.profile_strengths;
create policy "Owner can read" on public.profile_strengths for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owner can insert" on public.profile_strengths;
create policy "Owner can insert" on public.profile_strengths for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owner can update" on public.profile_strengths;
create policy "Owner can update" on public.profile_strengths for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owner can delete" on public.profile_strengths;
create policy "Owner can delete" on public.profile_strengths for delete to authenticated
  using ((select auth.uid()) = user_id);

-- reports: service role only (no grants, no policies for anon/authenticated), like chat_usage.
-- Reports arrive only through POST /api/report, which checks the Origin, rate-limits by hashed IP, requires a
-- known program id and fact field, strips control characters, and inserts with the service role (bypasses RLS).
-- A direct PostgREST insert with the public anon key would skip all of that, so it is not allowed.
-- The drop below also removes the old "Anyone can report" insert policy when this file is re-run on a database
-- created from an earlier version of it.
revoke all on public.reports from anon, authenticated;
drop policy if exists "Anyone can report" on public.reports;

-- chat_usage: no policies at all (service role only, which bypasses RLS).
revoke all on public.chat_usage from anon, authenticated;

-- The service role bypasses RLS but still needs table privileges. Newer Supabase projects do not always grant
-- them on new tables automatically, so grant them explicitly (seed script, hard delete, reports, chat budgets).
grant all on public.institutions, public.programs, public.country_facts, public.conversion_rules,
  public.fx_rates, public.profiles, public.profile_strengths, public.reports, public.chat_usage to service_role;
revoke execute on function public.add_chat_usage(text, date, integer) from public, anon, authenticated;
grant execute on function public.add_chat_usage(text, date, integer) to service_role;
