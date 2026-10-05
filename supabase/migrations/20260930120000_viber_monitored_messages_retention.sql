-- Keep only the newest 30 monitored messages per instance (across all of its
-- groups). Newest = sent_at desc, then id desc. The bot's monitoring cursor
-- lives in its own monitor-state.json, so trimming rows here never rewinds it.

create index if not exists viber_monitored_messages_instance_sent_idx
  on public.viber_monitored_messages (instance_id, sent_at desc, id desc);

create or replace function public.viber_monitored_messages_trim(p_instance_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  keep constant integer := 30;
begin
  -- Serialise trims of one instance so concurrent inserts cannot both miss
  -- each other's row and leave the instance above the limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('viber_monitored_messages:' || p_instance_id, 0));

  delete from public.viber_monitored_messages m
  using (
    select id
    from public.viber_monitored_messages
    where instance_id = p_instance_id
    order by sent_at desc, id desc
    offset keep
  ) stale
  where m.id = stale.id;
end
$$;

create or replace function public.viber_monitored_messages_enforce_retention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance_id text;
begin
  for v_instance_id in
    select distinct instance_id from new_rows order by instance_id
  loop
    perform public.viber_monitored_messages_trim(v_instance_id);
  end loop;
  return null;
end
$$;

revoke execute on function public.viber_monitored_messages_trim(text) from public;
revoke execute on function public.viber_monitored_messages_enforce_retention() from public;

do $$
declare
  api_role text;
begin
  for api_role in
    select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
  loop
    execute format('revoke execute on function public.viber_monitored_messages_trim(text) from %I', api_role);
    execute format('revoke execute on function public.viber_monitored_messages_enforce_retention() from %I', api_role);
  end loop;
end
$$;

-- Statement-level AFTER INSERT: fires for plain inserts and for the insert arm
-- of the Kotlin upsert; rows that hit ON CONFLICT DO UPDATE are not in
-- new_rows, so an update of an existing message never triggers a trim.
drop trigger if exists viber_monitored_messages_retention on public.viber_monitored_messages;

create trigger viber_monitored_messages_retention
  after insert on public.viber_monitored_messages
  referencing new table as new_rows
  for each statement
  execute function public.viber_monitored_messages_enforce_retention();

-- One-time trim of what accumulated before the limit existed.
select public.viber_monitored_messages_trim(instance_id)
from (select distinct instance_id from public.viber_monitored_messages) as instances;
