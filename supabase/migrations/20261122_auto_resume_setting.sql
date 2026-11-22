alter table public.studios
  add column if not exists auto_resume_enabled boolean not null default true;
