create table if not exists public.youtube_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.youtube_oauth_states enable row level security;
revoke all on public.youtube_oauth_states from anon, authenticated;

create table if not exists public.youtube_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.youtube_connections enable row level security;
revoke all on public.youtube_connections from anon, authenticated;

create table if not exists public.youtube_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  youtube_video_id text not null,
  status text not null default 'uploaded',
  privacy_status text not null default 'public',
  watch_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, video_id)
);
alter table public.youtube_publications enable row level security;
revoke all on public.youtube_publications from anon, authenticated;
