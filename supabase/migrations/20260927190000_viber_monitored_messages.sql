alter table public.viber_groups
  add column if not exists instance_id text not null default 'default';

alter table public.viber_groups
  drop constraint if exists viber_groups_group_key_key;

create unique index if not exists viber_groups_instance_group_key_key
  on public.viber_groups (instance_id, group_key);

drop index if exists public.viber_groups_instance_conversation_key;

create index if not exists viber_groups_instance_conversation_idx
  on public.viber_groups (instance_id, conversation_id);

create table if not exists public.viber_monitored_messages (
  id                bigint generated always as identity primary key,
  group_id          bigint      not null references public.viber_groups (id) on delete cascade,
  instance_id       text        not null,
  conversation_id   integer     not null,
  source_key        text        not null,
  source_message_id bigint      not null,
  viber_token       text,
  sender_name       text,
  sent_at           timestamptz not null,
  phone             text,
  phone_source      text        not null
    check (phone_source in ('message_text', 'viber_profile', 'none')),
  content           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (instance_id, conversation_id, source_key)
);

create index if not exists viber_monitored_messages_group_sent_idx
  on public.viber_monitored_messages (group_id, sent_at desc);

alter table public.viber_monitored_messages enable row level security;
