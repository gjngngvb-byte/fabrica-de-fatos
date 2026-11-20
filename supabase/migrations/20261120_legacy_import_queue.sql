create table if not exists public.legacy_imports (
 id uuid primary key default gen_random_uuid(),
 payload jsonb not null,
 claimed_by uuid references auth.users(id) on delete set null,
 claimed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.legacy_imports enable row level security;
