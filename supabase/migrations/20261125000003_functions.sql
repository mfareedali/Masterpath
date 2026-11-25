-- MastersPath 003 (25 Nov 2026): indexes and the SQL ranking functions.
--
-- RANKING RULE (same as src/lib/rank.ts, non-negotiable): only Verified or Likely values get a rank. Rows with no
-- usable value come LAST with rank = null, data_missing = true and a plain-language missing_reason. A missing value
-- is never sorted as zero or infinity.
--
-- "Rank by fit" is NOT here: it needs the student's grade and the conversion rules, and stays in app code
-- (src/lib/fit). The fit label always comes from that engine, never from the database or the AI.
--
-- Money is normalised to US dollars. Converting another currency needs a usable PKR exchange rate for it AND for
-- USD (data/fx_rates.seed.json), fetched within 45 days (FX_MAX_AGE_DAYS in src/lib/cost.ts). Until those rates
-- are verified, only fees charged in USD can be ranked by money; everything else is listed as data missing.

-- ---------------------------------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------------------------------

-- Filters used by the shortlist (country + field).
create index if not exists programs_country_field_idx on public.programs (country, field);
-- Program name search.
create index if not exists programs_name_search_idx on public.programs using gin (to_tsvector('simple', name));

-- ---------------------------------------------------------------------------------------------------
-- Exchange rates (mirror of pkrRateStatus in src/lib/cost.ts)
-- ---------------------------------------------------------------------------------------------------

-- PKR per 1 unit of a currency. rate is null when there is no usable rate; problem then says why.
create or replace function public.pkr_rate(
  p_currency text,
  p_now timestamptz default now(),
  out rate numeric,
  out confidence text,
  out problem text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  f jsonb;
  c text;
  r numeric;
  fetched timestamptz;
begin
  if p_currency = 'PKR' then
    rate := 1;
    confidence := 'Verified';
    return;
  end if;
  select x.pkr_per_unit into f from public.fx_rates as x where x.currency = p_currency;
  if not found then
    problem := format('No verified %s→PKR exchange rate yet', p_currency);
    return;
  end if;
  c := public.fact_confidence(f, p_now);
  if c = 'Conflict' then
    problem := format('%s→PKR exchange rate sources conflict', p_currency);
    return;
  end if;
  r := public.jsonb_number(f -> 'value');
  if c not in ('Verified', 'Likely') or r is null or r <= 0 then
    problem := format('No verified %s→PKR exchange rate yet', p_currency);
    return;
  end if;
  fetched := public.safe_timestamptz(f ->> 'fetched_at');
  if fetched is null then
    problem := format('The %s→PKR exchange rate has no date, so we cannot use it', p_currency);
    return;
  end if;
  if floor(extract(epoch from (p_now - fetched)) / 86400) > 45 then
    problem := format('%s→PKR exchange rate is older than 45 days', p_currency);
    return;
  end if;
  rate := r;
  confidence := c;
end;
$$;

-- US dollars per 1 unit of a currency (through PKR, the only rates we store). USD itself needs no rate.
create or replace function public.usd_per_unit(
  p_currency text,
  p_now timestamptz default now(),
  out rate numeric,
  out confidence text,
  out problem text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  a record;
  u record;
begin
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    problem := 'Currency missing or unreadable';
    return;
  end if;
  if p_currency = 'USD' then
    rate := 1;
    confidence := 'Verified';
    return;
  end if;
  select * into a from public.pkr_rate(p_currency, p_now);
  if a.rate is null then
    problem := a.problem || format(' (needed to convert %s to USD)', p_currency);
    return;
  end if;
  select * into u from public.pkr_rate('USD', p_now);
  if u.rate is null then
    problem := u.problem || format(' (needed to convert %s to USD)', p_currency);
    return;
  end if;
  rate := a.rate / u.rate;
  confidence := public.weakest_confidence(a.confidence, u.confidence);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Money over time (mirror of moneyOverDuration / moneyOverDurationProblem in src/lib/cost.ts)
-- ---------------------------------------------------------------------------------------------------

-- A Money value ({ amount, currency, period }) per year. A 'total' fee needs the programme length.
create or replace function public.money_per_year(m jsonb, p_months numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case m ->> 'period'
    when 'year' then public.jsonb_number(m -> 'amount')
    when 'semester' then public.jsonb_number(m -> 'amount') * 2
    when 'month' then public.jsonb_number(m -> 'amount') * 12
    when 'total' then case when p_months > 0 then public.jsonb_number(m -> 'amount') * 12 / p_months end
  end;
$$;

-- A Money value over the whole programme, or null when that cannot be done honestly (no length, or a length that
-- is not a whole number of the fee's period: 15 months of a per-semester fee is not 2.5 semesters of it).
create or replace function public.money_over_duration(m jsonb, p_months numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when public.jsonb_number(m -> 'amount') is null then null
    when m ->> 'period' = 'total' then public.jsonb_number(m -> 'amount')
    when p_months is null or p_months <= 0 then null
    when m ->> 'period' = 'month' then
      case when p_months = trunc(p_months) then public.jsonb_number(m -> 'amount') * p_months end
    when m ->> 'period' = 'year' then
      case when mod(p_months, 12) = 0 then public.jsonb_number(m -> 'amount') * p_months / 12 end
    when m ->> 'period' = 'semester' then
      case when mod(p_months, 6) = 0 then public.jsonb_number(m -> 'amount') * p_months / 6 end
  end;
$$;

create or replace function public.money_over_duration_problem(m jsonb, p_months numeric, p_label text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when public.money_over_duration(m, p_months) is not null then null
    when p_months is null or p_months <= 0 then format('Programme length not verified yet (needed to total %s)', p_label)
    else format(
      'Programme length (%s months) is not a whole number of %s, so we cannot total the %s',
      trim_scale(p_months),
      case m ->> 'period' when 'month' then 'months' when 'semester' then 'semesters' else 'years' end,
      p_label
    )
  end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- One program's ranking value for one key
-- ---------------------------------------------------------------------------------------------------

-- Keys:
--   tuition_per_year      tuition per year in USD
--   living_cost_per_year  living cost per year in USD
--   total_cost            tuition + living for the whole programme in USD (both needed, like programTotalCost)
--   study_months          programme length in months
--   deadline              application deadline as days since 1970-01-01 (a deadline that has passed is not ranked)
-- sort_value is null unless the value is usable; missing_reason then says why in plain words.
create or replace function public.program_rank_key(
  p public.programs,
  p_key text,
  p_now timestamptz default now(),
  out sort_value numeric,
  out confidence text,
  out missing_reason text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  usable constant text[] := array['Verified', 'Likely'];
  dc text := public.fact_confidence(p.duration_months, p_now);
  months numeric;
  c text;
  m jsonb;
  label text;
  amount numeric;
  fx record;
  days integer;
  part record;
  missing text[] := '{}';
  confs text[] := '{}';
  amounts numeric[] := '{}';
  currencies text[] := '{}';
  total numeric := 0;
  i integer;
begin
  months := case when dc = any (usable) then public.jsonb_number(p.duration_months -> 'value') end;
  if months is not null and months <= 0 then
    months := null;
  end if;

  if p_key = 'study_months' then
    confidence := dc;
    if dc = 'Conflict' then
      missing_reason := 'Programme length sources conflict';
    elsif months is null then
      missing_reason := 'Programme length not verified yet';
    else
      sort_value := months;
    end if;
    return;
  end if;

  if p_key = 'deadline' then
    confidence := public.fact_confidence(p.deadline, p_now);
    if confidence = 'Conflict' then
      missing_reason := 'Deadline sources conflict';
      return;
    end if;
    if not (confidence = any (usable)) or coalesce(p.deadline ->> 'value', '') !~ '\S' then
      missing_reason := 'Deadline not verified yet';
      return;
    end if;
    days := public.safe_epoch_days(p.deadline ->> 'value');
    if days is null then
      missing_reason := 'Deadline date is not in a readable format';
      return;
    end if;
    if days < floor(extract(epoch from p_now) / 86400) then
      missing_reason := format('Deadline has passed (%s). The next deadline is not verified yet.', p.deadline ->> 'value');
      return;
    end if;
    sort_value := days;
    return;
  end if;

  if p_key in ('tuition_per_year', 'living_cost_per_year') then
    if p_key = 'tuition_per_year' then
      m := p.tuition;
      label := 'Tuition';
    else
      m := p.living_cost;
      label := 'Living cost';
    end if;
    c := public.fact_confidence(m, p_now);
    confidence := c;
    if c = 'Conflict' then
      missing_reason := label || ' sources conflict';
      return;
    end if;
    if not (c = any (usable)) or jsonb_typeof(m -> 'value') is distinct from 'object' then
      missing_reason := label || ' not verified yet';
      return;
    end if;
    amount := public.money_per_year(m -> 'value', months);
    if amount is null then
      missing_reason := case
        when m -> 'value' ->> 'period' = 'total'
          then format('Programme length not verified yet (needed for a yearly %s figure)', lower(label))
        else label || ' amount is not in a readable format'
      end;
      return;
    end if;
    if m -> 'value' ->> 'period' = 'total' then
      c := public.weakest_confidence(c, dc);
    end if;
    select * into fx from public.usd_per_unit(m -> 'value' ->> 'currency', p_now);
    if fx.rate is null then
      confidence := c;
      missing_reason := fx.problem;
      return;
    end if;
    sort_value := round(amount * fx.rate, 2);
    confidence := public.weakest_confidence(c, fx.confidence);
    return;
  end if;

  if p_key = 'total_cost' then
    for part in
      select v.part_label, v.part_fact, public.fact_confidence(v.part_fact, p_now) as part_conf
      from (values ('tuition', p.tuition), ('living cost', p.living_cost)) as v(part_label, part_fact)
    loop
      if not (part.part_conf = any (usable)) or jsonb_typeof(part.part_fact -> 'value') is distinct from 'object' then
        missing := missing || case
          when part.part_label = 'tuition' and part.part_conf = 'Conflict' then 'Tuition sources conflict'
          when part.part_label = 'tuition' then 'Tuition not verified yet'
          when part.part_conf = 'Conflict' then 'Living-cost sources conflict'
          else 'Living cost not verified yet'
        end;
        continue;
      end if;
      amount := public.money_over_duration(part.part_fact -> 'value', months);
      if amount is null then
        missing := missing || coalesce(
          public.money_over_duration_problem(part.part_fact -> 'value', months, part.part_label),
          'Cannot total ' || part.part_label
        );
        continue;
      end if;
      amounts := amounts || amount;
      currencies := currencies || (part.part_fact -> 'value' ->> 'currency');
      confs := confs || part.part_conf;
      if part.part_fact -> 'value' ->> 'period' is distinct from 'total' then
        confs := confs || dc;
      end if;
    end loop;

    if cardinality(missing) > 0 or cardinality(amounts) < 2 then
      confidence := 'Unverified';
      missing_reason := coalesce(nullif(array_to_string(missing, '; '), ''), 'Cost data incomplete');
      return;
    end if;

    for i in 1 .. cardinality(amounts) loop
      select * into fx from public.usd_per_unit(currencies[i], p_now);
      if fx.rate is null then
        confidence := public.weakest_confidence(variadic confs);
        missing_reason := fx.problem;
        return;
      end if;
      total := total + amounts[i] * fx.rate;
      confs := confs || fx.confidence;
    end loop;

    sort_value := round(total, 2);
    confidence := public.weakest_confidence(variadic confs);
    return;
  end if;

  raise exception 'program_rank_key: unknown key "%"', p_key using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- rank_programs: one page of programs ranked by a key
-- ---------------------------------------------------------------------------------------------------

-- p_sort_key   tuition_per_year | living_cost_per_year | total_cost | study_months | deadline
-- p_direction  asc | desc
-- p_country    country code as stored ('DE', 'CH', 'UK', 'CA', 'US'), or null for all
-- p_limit      page size, 1..100;  p_offset rows to skip
-- p_field      field slug ('cs'), or null for all
-- p_now        "today" for confidence ages and passed deadlines (null = now(); set it to pin a recorded demo)
-- Ruled-out programs (status 'ruled_out') are never ranked and are not returned.
-- rank is the position among RANKED rows (stable across pages). total_count counts every returned row of the
-- filtered list, so callers can paginate.
create or replace function public.rank_programs(
  p_sort_key text,
  p_direction text default 'asc',
  p_country text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_field text default null,
  p_now timestamptz default null
)
returns table (
  program_id text,
  program_name text,
  institution_name text,
  country text,
  field text,
  pathway_type text,
  sort_value numeric,
  confidence text,
  rank bigint,
  data_missing boolean,
  missing_reason text,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_desc boolean;
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_sort_key is null
     or p_sort_key not in ('tuition_per_year', 'living_cost_per_year', 'total_cost', 'study_months', 'deadline') then
    raise exception 'rank_programs: unknown sort key "%"', p_sort_key
      using errcode = '22023',
            hint = 'Use tuition_per_year, living_cost_per_year, total_cost, study_months or deadline. Fit is ranked in app code.';
  end if;
  if lower(coalesce(p_direction, 'asc')) not in ('asc', 'desc') then
    raise exception 'rank_programs: direction must be asc or desc' using errcode = '22023';
  end if;
  v_desc := lower(coalesce(p_direction, 'asc')) = 'desc';

  return query
  with base as (
    select
      pr.id as b_id,
      pr.name as b_name,
      i.name as b_institution,
      pr.country as b_country,
      pr.field as b_field,
      pr.pathway_type as b_pathway,
      k.sort_value as b_value,
      k.confidence as b_confidence,
      k.missing_reason as b_reason,
      (k.sort_value is null or k.confidence not in ('Verified', 'Likely')) as b_missing
    from public.programs as pr
    join public.institutions as i on i.id = pr.institution_id
    cross join lateral public.program_rank_key(pr, p_sort_key, v_now) as k
    where pr.status = 'active'
      and (p_country is null or pr.country = p_country)
      and (p_field is null or pr.field = p_field)
  ),
  ranked as (
    select
      b.*,
      row_number() over (
        order by b.b_missing, (case when v_desc then -b.b_value else b.b_value end) nulls last, b.b_name, b.b_id
      ) as b_pos,
      count(*) over () as b_total
    from base as b
  )
  select
    r.b_id,
    r.b_name,
    r.b_institution,
    r.b_country,
    r.b_field,
    r.b_pathway,
    case when r.b_missing then null else r.b_value end,
    r.b_confidence,
    case when r.b_missing then null else r.b_pos end,
    r.b_missing,
    case when r.b_missing then coalesce(r.b_reason, 'Data missing or not verified yet') end,
    r.b_total
  from ranked as r
  order by r.b_pos
  limit greatest(least(coalesce(p_limit, 20), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- rank_countries: destination countries ranked by a country rule's number of months
-- ---------------------------------------------------------------------------------------------------

-- p_key: citizenship_rule (usually asc: shortest wait first), post_study_work (usually desc: longest permit first)
--        or pr_route. rank_value is value.sort_months: the number the rule is compared by, not the law itself.
--        Students read value_text, which is the rule.
-- Countries: every country with an active program, plus the supported destinations CA, CH, DE, UK, US. A country
-- with no usable rule is listed last with data_missing = true.
create or replace function public.rank_countries(
  p_key text,
  p_direction text default 'asc',
  p_now timestamptz default null
)
returns table (
  country text,
  value_text text,
  rank_value numeric,
  confidence text,
  source_url text,
  evidence_snippet text,
  fetched_at timestamptz,
  rank bigint,
  data_missing boolean,
  missing_reason text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_desc boolean;
  v_now timestamptz := coalesce(p_now, now());
  v_label text;
begin
  v_label := case p_key
    when 'citizenship_rule' then 'Citizenship rule'
    when 'post_study_work' then 'Post-study work rule'
    when 'pr_route' then 'Permanent residence rule'
  end;
  if v_label is null then
    raise exception 'rank_countries: unknown key "%"', p_key
      using errcode = '22023',
            hint = 'Use citizenship_rule, post_study_work or pr_route (the country rules ranked by a number of months).';
  end if;
  if lower(coalesce(p_direction, 'asc')) not in ('asc', 'desc') then
    raise exception 'rank_countries: direction must be asc or desc' using errcode = '22023';
  end if;
  v_desc := lower(coalesce(p_direction, 'asc')) = 'desc';

  return query
  with countries as (
    select distinct x.c
    from (
      select pr.country from public.programs as pr where pr.status = 'active'
      union
      select unnest(array['CA', 'CH', 'DE', 'UK', 'US'])
    ) as x(c)
  ),
  facts as (
    select
      f.country as f_country,
      f.value as f_value,
      f.source_url as f_url,
      f.evidence_snippet as f_snippet,
      f.fetched_at as f_fetched,
      public.fact_confidence(
        jsonb_build_object(
          'value', f.value,
          'source_url', f.source_url,
          'evidence_snippet', f.evidence_snippet,
          'fetched_at', f.fetched_at,
          'basis', f.basis,
          'conflicts', f.conflicts
        ),
        v_now
      ) as f_conf
    from public.country_facts as f
    where f.key = p_key
  ),
  base as (
    select
      c.c as b_country,
      fa.f_value ->> 'text' as b_text,
      public.jsonb_number(fa.f_value -> 'sort_months') as b_value,
      coalesce(fa.f_conf, 'Unverified') as b_conf,
      fa.f_url as b_url,
      fa.f_snippet as b_snippet,
      fa.f_fetched as b_fetched,
      case
        when fa.f_country is null then v_label || ' not verified yet'
        when fa.f_conf = 'Conflict' then v_label || ' sources conflict'
        when fa.f_conf not in ('Verified', 'Likely') then v_label || ' not verified yet'
        when public.jsonb_number(fa.f_value -> 'sort_months') is null
          then v_label || ' has no comparable number of months yet'
      end as b_reason
    from countries as c
    left join facts as fa on fa.f_country = c.c
  ),
  ranked as (
    select
      b.*,
      (b.b_reason is not null) as b_missing,
      row_number() over (
        order by (b.b_reason is not null), (case when v_desc then -b.b_value else b.b_value end) nulls last, b.b_country
      ) as b_pos
    from base as b
  )
  select
    r.b_country,
    r.b_text,
    case when r.b_missing then null else r.b_value end,
    r.b_conf,
    r.b_url,
    r.b_snippet,
    r.b_fetched,
    case when r.b_missing then null else r.b_pos end,
    r.b_missing,
    r.b_reason
  from ranked as r
  order by r.b_pos;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Who may call them: anyone (they read public data only and run as the caller), never PUBLIC implicitly.
-- ---------------------------------------------------------------------------------------------------

revoke execute on function
  public.pkr_rate(text, timestamptz),
  public.usd_per_unit(text, timestamptz),
  public.money_per_year(jsonb, numeric),
  public.money_over_duration(jsonb, numeric),
  public.money_over_duration_problem(jsonb, numeric, text),
  public.program_rank_key(public.programs, text, timestamptz),
  public.rank_programs(text, text, text, integer, integer, text, timestamptz),
  public.rank_countries(text, text, timestamptz)
from public;

grant execute on function
  public.pkr_rate(text, timestamptz),
  public.usd_per_unit(text, timestamptz),
  public.money_per_year(jsonb, numeric),
  public.money_over_duration(jsonb, numeric),
  public.money_over_duration_problem(jsonb, numeric, text),
  public.program_rank_key(public.programs, text, timestamptz),
  public.rank_programs(text, text, text, integer, integer, text, timestamptz),
  public.rank_countries(text, text, timestamptz)
to anon, authenticated, service_role;
