alter table public.youtube_oauth_states
  add column if not exists return_to text;
