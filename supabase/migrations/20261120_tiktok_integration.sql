create table if not exists public.tiktok_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  open_id text not null, display_name text, access_token text not null, refresh_token text not null,
  access_token_expires_at timestamptz not null, refresh_token_expires_at timestamptz not null,
  scope text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.tiktok_connections enable row level security;
create table if not exists public.tiktok_oauth_states (
  state text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
alter table public.tiktok_oauth_states enable row level security;
create table if not exists public.tiktok_publications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade, publish_id text not null,
  status text not null default 'processing', share_url text, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.tiktok_publications enable row level security;
create policy "Users read own TikTok publications" on public.tiktok_publications
for select to authenticated using (user_id=(select auth.uid()));
