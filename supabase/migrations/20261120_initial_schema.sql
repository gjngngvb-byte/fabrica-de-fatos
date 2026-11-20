create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin','user')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (new.id, 'user', coalesce(new.raw_user_meta_data ->> 'name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  niche text not null default 'Fatos surpreendentes',
  tone text not null default 'curioso, direto e levemente provocador',
  language text not null default 'pt-BR',
  voice text not null default 'river' check (voice in ('river','honey','sunny','storm','spark')),
  videos_per_day integer not null default 5 check (videos_per_day between 1 and 10),
  duration_target integer not null default 30 check (duration_target between 10 and 90),
  visual_style text not null default 'fotografia editorial cinematográfica, luz dramática lateral, cores quentes e profundas, textura de filme 35mm',
  base_hashtags text[] not null default array['fatoscuriosos','vocesabia','curiosidades']::text[],
  cta text not null default 'Segue para mais um fato por dia.',
  avoid text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studios_created_by_idx on public.studios(created_by);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  hook text not null default '',
  fact text not null default '',
  script text not null default '',
  caption text not null default '',
  hashtags text[] not null default '{}'::text[],
  scenes jsonb not null default '[]'::jsonb,
  audio_url text not null default '',
  voice text not null default 'river',
  mp4_url text not null default '',
  render_job_id text not null default '',
  render_status text not null default 'ocioso' check (render_status in ('ocioso','renderizando','pronto','falhou')),
  render_error text not null default '',
  status text not null default 'planejado' check (status in ('planejado','roteiro','pronto','publicado','falhou')),
  scheduled_date date,
  slot integer,
  published_at timestamptz,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(created_by, scheduled_date, slot)
);
create index if not exists videos_created_by_created_at_idx on public.videos(created_by, created_at desc);
create index if not exists videos_created_by_schedule_idx on public.videos(created_by, scheduled_date, slot);

alter table public.profiles enable row level security;
alter table public.studios enable row level security;
alter table public.videos enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "Users manage own studio" on public.studios;
create policy "Users manage own studio" on public.studios for all to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
drop policy if exists "Users manage own videos" on public.videos;
create policy "Users manage own videos" on public.videos for all to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets','assets',false,52428800,array['image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4'])
on conflict (id) do nothing;
drop policy if exists "Users can read own assets" on storage.objects;
create policy "Users can read own assets" on storage.objects for select to authenticated using (bucket_id='assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Users can upload own assets" on storage.objects;
create policy "Users can upload own assets" on storage.objects for insert to authenticated with check (bucket_id='assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Users can update own assets" on storage.objects;
create policy "Users can update own assets" on storage.objects for update to authenticated using (bucket_id='assets' and (storage.foldername(name))[1]=(select auth.uid())::text) with check (bucket_id='assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Users can delete own assets" on storage.objects;
create policy "Users can delete own assets" on storage.objects for delete to authenticated using (bucket_id='assets' and (storage.foldername(name))[1]=(select auth.uid())::text);
