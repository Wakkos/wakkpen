-- Cada ejercicio con su propio HTML/CSS de base, vista previa opcional para el alumno y correcciones hechas por Claude.

alter table public.exercises
  add column base_html    text not null default '' check (char_length(base_html) <= 50000),
  add column base_css     text not null default '' check (char_length(base_css) <= 50000),
  add column show_preview boolean not null default false;
alter table public.exercises alter column allow_pen set default false;

alter table public.submissions
  add column graded_by text check (graded_by in ('teacher', 'claude'));

create or replace function public.grade_submission(p_submission uuid, p_status text, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_teacher() then
    raise exception 'Solo el profesor puede corregir' using errcode = '42501';
  end if;
  if p_status not in ('submitted', 'ok', 'review') then
    raise exception 'Estado no válido' using errcode = '22023';
  end if;
  update public.submissions
  set status = p_status,
      comment = coalesce(p_comment, ''),
      graded_at = case when p_status = 'submitted' then null else now() end,
      graded_by = case when p_status = 'submitted' then null else 'teacher' end
  where id = p_submission;
end;
$$;
