alter table public.studios drop constraint if exists studios_duration_target_check;
update public.studios set duration_target = 180 where duration_target is null or duration_target < 120 or duration_target > 300;
alter table public.studios alter column duration_target set default 180;
alter table public.studios add constraint studios_duration_target_check check (duration_target between 120 and 300);
