-- MastersPath 002 (25 Nov 2026): access rules for the objects added in 001.
--
-- Row level security itself was enabled on EVERY table in 20261124000000_init.sql:
--   * reference data (institutions, programs, country_facts, conversion_rules, fx_rates): anyone can read,
--     only the service role can write (SELECT policies only + write grants revoked);
--   * profiles, profile_strengths: the signed-in owner only, (select auth.uid()) = user_id, for every command;
--   * reports, chat_usage: service role only (POST /api/report validates, rate-limits and inserts them).
--
-- This file:
--   1. Views: Supabase's default privileges give anon/authenticated ALL privileges on every new view. The views
--      are read-only reports over public data, so revoke everything and grant SELECT only. They are
--      security_invoker views, so the base tables' RLS policies still decide which rows come back.
--   2. Functions: callable by anon/authenticated (they only read public data and run as the caller), never by
--      PUBLIC implicitly.
--   3. reports / chat_usage: an explicit RESTRICTIVE deny-all policy for anon and authenticated. Behaviour does not
--      change (no permissive policy and no grants already meant no access); it states the intent in the database
--      and clears the "RLS enabled, no policy" advisor notice.

-- 1. Views: read-only -----------------------------------------------------------------------------

revoke all on public.program_facts, public.program_facts_computed, public.country_facts_computed,
  public.program_fact_conflicts from public, anon, authenticated;
grant select on public.program_facts, public.program_facts_computed, public.country_facts_computed,
  public.program_fact_conflicts to anon, authenticated;
grant select on public.program_facts, public.program_facts_computed, public.country_facts_computed,
  public.program_fact_conflicts to service_role;

-- 2. Functions -----------------------------------------------------------------------------------

revoke execute on function
  public.safe_timestamptz(text),
  public.safe_epoch_days(text),
  public.jsonb_number(jsonb),
  public.computed_confidence(jsonb, text, text, timestamptz, text, timestamptz),
  public.source_confidence(jsonb, timestamptz),
  public.fact_has_conflict(jsonb),
  public.fact_confidence(jsonb, timestamptz),
  public.weakest_confidence(text[])
from public;

grant execute on function
  public.safe_timestamptz(text),
  public.safe_epoch_days(text),
  public.jsonb_number(jsonb),
  public.computed_confidence(jsonb, text, text, timestamptz, text, timestamptz),
  public.source_confidence(jsonb, timestamptz),
  public.fact_has_conflict(jsonb),
  public.fact_confidence(jsonb, timestamptz),
  public.weakest_confidence(text[])
to anon, authenticated, service_role;

-- 3. Service-role-only tables: explicit deny for the API roles ------------------------------------

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and policyname = 'No direct access') then
    create policy "No direct access" on public.reports as restrictive for all to anon, authenticated
      using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_usage' and policyname = 'No direct access') then
    create policy "No direct access" on public.chat_usage as restrictive for all to anon, authenticated
      using (false) with check (false);
  end if;
end;
$$;
