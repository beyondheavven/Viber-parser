-- Retention of viber_monitored_messages: at most 30 rows per instance_id,
-- newest by (sent_at desc, id desc) survive. Run with supabase/tests/run.sh.

begin;

create function pg_temp.add_group(p_instance text, p_conversation integer)
returns bigint language sql as $$
  insert into public.viber_groups (group_key, conversation_id, instance_id)
  values ('it-' || p_instance || '-' || p_conversation, p_conversation, p_instance)
  returning id
$$;

create function pg_temp.add_message(p_group bigint, p_instance text, p_conversation integer, p_n integer)
returns void language sql as $$
  insert into public.viber_monitored_messages
    (group_id, instance_id, conversation_id, source_key, source_message_id, sent_at, phone_source)
  values
    (p_group, p_instance, p_conversation, 'row:' || p_n, p_n,
     timestamptz '2026-01-01 00:00:00+00' + make_interval(mins => p_n), 'none')
$$;

create function pg_temp.assert_eq(p_actual bigint, p_expected bigint, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_label, p_expected, p_actual;
  end if;
end
$$;

-- 1. One insert per statement (how the Kotlin upsert writes), spread over two groups.
do $$
declare
  g1 bigint := pg_temp.add_group('it-a', 1);
  g2 bigint := pg_temp.add_group('it-a', 2);
  other bigint := pg_temp.add_group('it-b', 1);
begin
  for n in 1..5 loop
    perform pg_temp.add_message(other, 'it-b', 1, n);
  end loop;
  for n in 1..35 loop
    perform pg_temp.add_message(
      case when n % 2 = 0 then g1 else g2 end, 'it-a', case when n % 2 = 0 then 1 else 2 end, n);
  end loop;

  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-a'), 30, 'instance capped at 30');
  perform pg_temp.assert_eq(
    (select min(source_message_id) from public.viber_monitored_messages where instance_id = 'it-a'), 6, 'oldest removed first');
  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-b'), 5, 'other instance untouched');
end
$$;

-- 2. Upsert of an existing row (ON CONFLICT DO UPDATE) deletes nothing.
do $$
begin
  insert into public.viber_monitored_messages
    (group_id, instance_id, conversation_id, source_key, source_message_id, sent_at, phone_source, content)
  select group_id, instance_id, conversation_id, source_key, source_message_id, sent_at, phone_source, 'edited'
  from public.viber_monitored_messages
  where instance_id = 'it-a' and source_message_id = 6
  on conflict (instance_id, conversation_id, source_key)
  do update set content = excluded.content, updated_at = now();

  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-a'), 30, 'upsert keeps 30');
  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages
      where instance_id = 'it-a' and source_message_id = 6 and content = 'edited'), 1, 'updated row survives');
end
$$;

-- 3. A late-arriving message older than everything kept is dropped at once.
do $$
begin
  perform pg_temp.add_message(
    (select id from public.viber_groups where group_key = 'it-it-a-1'), 'it-a', 1, 0);

  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-a'), 30, 'late message keeps 30');
  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages
      where instance_id = 'it-a' and source_message_id = 0), 0, 'late message removed');
end
$$;

-- 4. Multi-row insert, with equal sent_at: ties are broken by id (lower id goes first).
do $$
declare
  g bigint := pg_temp.add_group('it-c', 1);
begin
  insert into public.viber_monitored_messages
    (group_id, instance_id, conversation_id, source_key, source_message_id, sent_at, phone_source)
  select g, 'it-c', 1, 'row:' || n, n, timestamptz '2026-01-01 00:00:00+00', 'none'
  from generate_series(1, 40) as n
  order by n;

  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-c'), 30, 'batch capped at 30');
  perform pg_temp.assert_eq(
    (select min(source_message_id) from public.viber_monitored_messages where instance_id = 'it-c'), 11, 'tie broken by id');
end
$$;

-- 5. The one-time trim used by the migration cuts pre-existing overflow.
do $$
declare
  g bigint := pg_temp.add_group('it-d', 1);
begin
  alter table public.viber_monitored_messages disable trigger viber_monitored_messages_retention;
  for n in 1..50 loop
    perform pg_temp.add_message(g, 'it-d', 1, n);
  end loop;
  alter table public.viber_monitored_messages enable trigger viber_monitored_messages_retention;

  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-d'), 50, 'seeded without trigger');

  perform public.viber_monitored_messages_trim(instance_id)
  from (select distinct instance_id from public.viber_monitored_messages) as instances;

  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-d'), 30, 'trim caps existing rows');
  perform pg_temp.assert_eq(
    (select min(source_message_id) from public.viber_monitored_messages where instance_id = 'it-d'), 21, 'trim keeps newest');
  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-b'), 5, 'trim leaves small instance');
end
$$;

-- 6. The trim helper is not callable by PUBLIC (and so not by the PostgREST API roles).
do $$
begin
  perform pg_temp.assert_eq(
    (select count(*) from pg_roles r
      where r.rolname in ('anon', 'authenticated')
        and has_function_privilege(r.oid, 'public.viber_monitored_messages_trim(text)', 'execute')),
    0, 'api roles cannot execute trim');
  perform pg_temp.assert_eq(
    (select count(*)
      from aclexplode((select proacl from pg_proc where oid = 'public.viber_monitored_messages_trim(text)'::regprocedure))
      where grantee = 0),
    0, 'public cannot execute trim');
  perform pg_temp.assert_eq(
    (select count(*) from pg_proc
      where oid = 'public.viber_monitored_messages_trim(text)'::regprocedure and proacl is not null),
    1, 'trim acl is explicit');
end
$$;

-- 7. A writer like service_role (bypassrls, insert but no delete, no execute on
--    the helper) still gets its instance trimmed by the trigger.
create role it_writer bypassrls;
grant select, insert, update on public.viber_monitored_messages to it_writer;
grant select on public.viber_groups to it_writer;

set local role it_writer;
do $$
begin
  for n in 100..109 loop
    insert into public.viber_monitored_messages
      (group_id, instance_id, conversation_id, source_key, source_message_id, sent_at, phone_source)
    values
      ((select id from public.viber_groups where group_key = 'it-it-a-1'), 'it-a', 1, 'row:' || n, n,
       timestamptz '2026-01-01 00:00:00+00' + make_interval(mins => n), 'none');
  end loop;

  perform pg_temp.assert_eq(
    (select count(*) from public.viber_monitored_messages where instance_id = 'it-a'), 30, 'writer role trimmed');
  perform pg_temp.assert_eq(
    (select max(source_message_id) from public.viber_monitored_messages where instance_id = 'it-a'), 109, 'writer rows kept');

  begin
    perform public.viber_monitored_messages_trim('it-a');
    raise exception 'FAIL writer could execute trim';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
reset role;

rollback;
