-- MastersPath 001 (25 Nov 2026): the evidence model as ROWS, built on the jsonb schema of 20261124000000_init.sql.
--
-- The app keeps reading the tables from the init migration (one jsonb column per fact). This migration adds a
-- row-per-fact view of the same data, so SQL clients can list, filter and rank facts with their evidence:
--
--   public.program_facts            VIEW  one row per SOURCE of a program fact: the primary source is source_index 0,
--                                         each other source in the fact's "conflicts" array is 1, 2, ...
--   public.computed_confidence(...)       the confidence rule of src/lib/confidence.ts, in SQL. Confidence is
--                                         COMPUTED from the evidence on every read, never trusted from a stored value.
--   public.program_facts_computed   VIEW  program_facts + confidence per source and per fact (Conflict wins).
--   public.country_facts_computed   VIEW  country_facts + computed confidence (the old cache column is not used).
--   public.program_fact_conflicts   VIEW  facts whose sourced values disagree: the UI's Conflict badge, both links.
--
-- Confidence rule (same as src/lib/confidence.ts; tests compare the two):
--   Unverified  no value; or no evidence snippet / no source URL (summary and inferred values need a URL only)
--   Verified    value + source URL + verbatim snippet + fetched within the last 30 days
--   Likely      has evidence but older than 30 days (or no date), or basis is 'summary' / 'inferred'
--   Conflict    another SOURCED value for the same fact differs
--
-- Only Verified and Likely values may ever be ranked or used for a decision.
-- All views use security_invoker, so the row level security of the base tables applies to whoever reads them.

-- ---------------------------------------------------------------------------------------------------
-- Small pure helpers
-- ---------------------------------------------------------------------------------------------------

-- Text -> timestamptz without ever raising (a malformed date in one fact must not break a whole view).
-- A bare YYYY-MM-DD is read as midnight UTC, like Date.parse in the app.
create or replace function public.safe_timestamptz(t text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if t is null or btrim(t) = '' then
    return null;
  end if;
  if t ~ '^\d{4}-\d{2}-\d{2}$' then
    return (t || 'T00:00:00Z')::timestamptz;
  end if;
  return t::timestamptz;
exception when others then
  return null;
end;
$$;

-- 'YYYY-MM-DD' -> whole days since 1970-01-01 (the app's isoToDays), or null when it is not a real date.
create or replace function public.safe_epoch_days(t text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return t::date - date '1970-01-01';
exception when others then
  return null;
end;
$$;

-- A jsonb number as numeric; null for anything else (never raises on a string or an object).
create or replace function public.jsonb_number(j jsonb)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Confidence, computed (mirror of src/lib/confidence.ts)
-- ---------------------------------------------------------------------------------------------------

-- Confidence of ONE source (ignores conflicts).
create or replace function public.computed_confidence(
  p_value jsonb,
  p_source_url text,
  p_evidence_snippet text,
  p_fetched_at timestamptz,
  p_basis text,
  p_now timestamptz default now()
)
returns text
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then 'Unverified'
    when coalesce(p_basis, case when coalesce(p_evidence_snippet, '') ~ '\S' then 'verbatim' end) in ('summary', 'inferred')
      then case when coalesce(p_source_url, '') ~ '\S' then 'Likely' else 'Unverified' end
    when coalesce(p_evidence_snippet, '') !~ '\S' or coalesce(p_source_url, '') !~ '\S' then 'Unverified'
    when p_fetched_at is null then 'Likely'
    when floor(extract(epoch from (p_now - p_fetched_at)) / 86400) <= 30 then 'Verified'
    else 'Likely'
  end;
$$;

-- Confidence of one jsonb source object { value, source_url, evidence_snippet, fetched_at, basis }.
create or replace function public.source_confidence(s jsonb, p_now timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when s is null or jsonb_typeof(s) <> 'object' then 'Unverified'
    else public.computed_confidence(
      s -> 'value',
      s ->> 'source_url',
      s ->> 'evidence_snippet',
      public.safe_timestamptz(s ->> 'fetched_at'),
      s ->> 'basis',
      p_now
    )
  end;
$$;

-- True when at least two SOURCED values of a fact differ. An alternative without a source URL is an unsourced
-- claim, not a second source, so it never creates a Conflict (same rule as hasConflict in the app).
create or replace function public.fact_has_conflict(f jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce((
    select count(*) >= 2 and count(distinct s.v) > 1
    from (
      select f -> 'value' as v
      where coalesce(jsonb_typeof(f -> 'value'), 'null') <> 'null'
      union all
      select c.src -> 'value'
      from jsonb_array_elements(
        case when jsonb_typeof(f -> 'conflicts') = 'array' then f -> 'conflicts' else '[]'::jsonb end
      ) as c(src)
      where coalesce(c.src ->> 'source_url', '') ~ '\S'
        and coalesce(jsonb_typeof(c.src -> 'value'), 'null') <> 'null'
    ) as s
  ), false);
$$;

-- Confidence of a whole fact (primary source + "conflicts"). Conflict wins over everything else.
create or replace function public.fact_confidence(f jsonb, p_now timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when f is null or jsonb_typeof(f) <> 'object' then 'Unverified'
    when public.fact_has_conflict(f) then 'Conflict'
    else public.source_confidence(f, p_now)
  end;
$$;

-- Weakest of several confidences: Conflict < Unverified < Likely < Verified (weakestConfidence in the app).
create or replace function public.weakest_confidence(variadic cs text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (array['Conflict', 'Unverified', 'Likely', 'Verified'])[
    min(array_position(array['Conflict', 'Unverified', 'Likely', 'Verified'], c.x))
  ]
  from unnest(cs) as c(x);
$$;

-- ---------------------------------------------------------------------------------------------------
-- Every program fact as rows, with its evidence
-- ---------------------------------------------------------------------------------------------------

-- key          the Program fact field (src/lib/types.ts), e.g. 'tuition', 'deadline', 'min_gpa_rule'
-- value        the value exactly as stored (jsonb: a string, a number, or an object such as Money / GpaRule)
-- value_text   a readable form: the string itself, or the object's "text", or the JSON
-- rank_value   a normalised number for keys that have one on their own: duration_months (months),
--              lor_count (letters), deadline (days since 1970-01-01). Money keys are normalised by
--              public.rank_programs, because a yearly USD figure needs exchange rates and the programme length.
-- in_conflict  the fact has sourced values that disagree (the same for every row of that fact)
create or replace view public.program_facts
with (security_invoker = true)
as
select
  p.id as program_id,
  f.key,
  s.source_index,
  s.src -> 'value' as value,
  case jsonb_typeof(s.src -> 'value')
    when 'string' then s.src ->> 'value'
    when 'object' then coalesce(s.src -> 'value' ->> 'text', (s.src -> 'value')::text)
    when 'null' then null
    else (s.src -> 'value')::text
  end as value_text,
  case f.key
    when 'duration_months' then public.jsonb_number(s.src -> 'value')
    when 'lor_count' then public.jsonb_number(s.src -> 'value')
    when 'deadline' then public.safe_epoch_days(s.src ->> 'value')::numeric
  end as rank_value,
  nullif(btrim(s.src ->> 'source_url'), '') as source_url,
  nullif(btrim(s.src ->> 'evidence_snippet'), '') as evidence_snippet,
  public.safe_timestamptz(s.src ->> 'fetched_at') as fetched_at,
  s.src ->> 'basis' as basis,
  s.src ->> 'note' as note,
  public.fact_has_conflict(f.fact) as in_conflict
from public.programs as p
cross join lateral (
  values
    ('status_note', p.status_note),
    ('intake', p.intake),
    ('deadline', p.deadline),
    ('min_gpa_rule', p.min_gpa_rule),
    ('language_req', p.language_req),
    ('tuition', p.tuition),
    ('living_cost', p.living_cost),
    ('duration_months', p.duration_months),
    ('scholarship_info', p.scholarship_info),
    ('sop_requirements', p.sop_requirements),
    ('lor_count', p.lor_count),
    ('cv_requirements', p.cv_requirements),
    ('tests_required', p.tests_required),
    ('research_considered', p.research_considered),
    ('progression_guaranteed', p.progression_guaranteed),
    ('progression_requirement', p.progression_requirement),
    ('eligibility_note', p.eligibility_note),
    ('conditional_admission', p.conditional_admission),
    ('language_waiver', p.language_waiver),
    ('admissions_email', p.admissions_email)
) as f(key, fact)
cross join lateral (
  select 0 as source_index, f.fact as src
  union all
  select c.ord::integer, c.src
  from jsonb_array_elements(
    case when jsonb_typeof(f.fact -> 'conflicts') = 'array' then f.fact -> 'conflicts' else '[]'::jsonb end
  ) with ordinality as c(src, ord)
) as s;

comment on view public.program_facts is
  'One row per source of each program fact (source_index 0 = primary). Built from the jsonb fact columns of public.programs.';

-- source_confidence  confidence of this row's source alone
-- confidence         confidence of the whole fact: Conflict if sourced values disagree, else the primary source's
create or replace view public.program_facts_computed
with (security_invoker = true)
as
select
  pf.*,
  sc.source_confidence,
  case
    when pf.in_conflict then 'Conflict'
    else first_value(sc.source_confidence) over (partition by pf.program_id, pf.key order by pf.source_index)
  end as confidence
from public.program_facts as pf
cross join lateral (
  select public.computed_confidence(pf.value, pf.source_url, pf.evidence_snippet, pf.fetched_at, pf.basis) as source_confidence
) as sc;

comment on view public.program_facts_computed is
  'program_facts with confidence COMPUTED on read (rule of src/lib/confidence.ts). Never read a stored confidence.';

-- rank_value: the months number a country rule is ranked by (value.sort_months). A ranking key, not the law:
-- students read value_text, the rule itself.
create or replace view public.country_facts_computed
with (security_invoker = true)
as
select
  f.id,
  f.country,
  f.key,
  f.value,
  f.value ->> 'text' as value_text,
  public.jsonb_number(f.value -> 'sort_months') as rank_value,
  f.source_url,
  f.evidence_snippet,
  f.fetched_at,
  f.basis,
  f.note,
  f.conflicts,
  sc.source_confidence,
  case
    when public.fact_has_conflict(jsonb_build_object('value', f.value, 'conflicts', f.conflicts)) then 'Conflict'
    else sc.source_confidence
  end as confidence,
  f.updated_at
from public.country_facts as f
cross join lateral (
  select public.computed_confidence(f.value, f.source_url, f.evidence_snippet, f.fetched_at, f.basis) as source_confidence
) as sc;

comment on view public.country_facts_computed is
  'country_facts with confidence COMPUTED on read. Ignores the country_facts.confidence cache column. No reviewer notes.';

-- Facts whose sourced values disagree. The UI shows a Conflict badge with every value and every link.
create or replace view public.program_fact_conflicts
with (security_invoker = true)
as
select
  pf.program_id,
  pf.key,
  count(distinct pf.value) as distinct_values,
  array_agg(pf.value_text order by pf.source_index) as value_texts,
  array_agg(pf.source_url order by pf.source_index) as sources
from public.program_facts as pf
where pf.in_conflict
  and pf.value is not null
  and jsonb_typeof(pf.value) <> 'null'
  and (pf.source_index = 0 or pf.source_url is not null)
group by pf.program_id, pf.key;

comment on view public.program_fact_conflicts is
  'Program facts with at least two sourced values that differ (same rule as hasConflict in src/lib/confidence.ts).';

-- ---------------------------------------------------------------------------------------------------
-- The confidence CACHE column may never claim Verified without evidence
-- ---------------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'country_facts_verified_needs_evidence' and conrelid = 'public.country_facts'::regclass
  ) then
    alter table public.country_facts add constraint country_facts_verified_needs_evidence check (
      confidence is distinct from 'Verified'
      or (
        coalesce(source_url, '') ~ '\S'
        and coalesce(evidence_snippet, '') ~ '\S'
        and fetched_at is not null
      )
    );
  end if;
end;
$$;
