alter table public.studios
  add column if not exists show_title_on_intro boolean not null default true,
  add column if not exists show_channel_name_on_outro boolean not null default true;
