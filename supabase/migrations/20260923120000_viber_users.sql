-- Optimised user base built from Viber's on-device SQLite (participants_info +
-- participants). Only the fields that identify a person or are useful for
-- outreach are kept; device-local ids, contact-book names, photo flags and the
-- like are dropped.
--
-- Applied to the Supabase project through `apply_migration`; kept here so the
-- schema can be recreated on another project.

create table if not exists public.viber_groups (
  id                bigint generated always as identity primary key,
  -- Stable key: the 64-bit Viber group id, or "conv:<id>" for chats without one.
  group_key         text        not null unique,
  viber_group_id    text,
  -- Row id of the conversation in the bot's SQLite. Device-local, kept only so
  -- the group can be addressed through /api/groups/{id}.
  conversation_id   integer,
  name              text,
  participant_count integer     not null default 0,
  last_synced_at    timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.viber_users (
  id            bigint generated always as identity primary key,
  -- Stable key: Viber member_id, or "phone:<digits>" while the id is still
  -- encrypted (em:...) on the device.
  identity_key  text        not null unique,
  member_id     text,
  -- E.164, e.g. +375336433350. Null when hidden by the user's privacy settings.
  phone         text,
  -- Best available display name (Viber profile name first).
  name          text,
  viber_name    text,
  is_online     boolean,
  last_seen_at  timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists viber_users_member_id_key
  on public.viber_users (member_id) where member_id is not null;
create index if not exists viber_users_phone_idx
  on public.viber_users (phone) where phone is not null;

create table if not exists public.viber_group_members (
  group_id  bigint      not null references public.viber_groups (id) on delete cascade,
  user_id   bigint      not null references public.viber_users (id)  on delete cascade,
  -- participants.group_role: 1 superadmin, 2 admin, 3 member.
  role      smallint,
  -- False once a sync of the group no longer lists the user.
  active    boolean     not null default true,
  synced_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists viber_group_members_user_idx
  on public.viber_group_members (user_id);

-- The API writes with the service key, which bypasses RLS; enabling it keeps
-- the anon/authenticated roles out until explicit policies are added.
alter table public.viber_groups        enable row level security;
alter table public.viber_users         enable row level security;
alter table public.viber_group_members enable row level security;
