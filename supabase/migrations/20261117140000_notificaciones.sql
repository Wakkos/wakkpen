-- Notificaciones dentro de la app: correcciones, hojas y soluciones publicadas, y avisos del profe.

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('graded', 'sheet', 'solution', 'notice')),
  title       text not null check (char_length(title) <= 300),
  link        text not null default '' check (char_length(link) <= 500),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_read on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
grant delete on public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;

-- Enlace a un ejercicio concreto dentro de su hoja.
create or replace function public.exercise_link(p_exercise uuid)
returns text language sql stable security definer set search_path = '' as $$
  select '/ejercicios/' || e.sheet_id || '?n=' || (e.position + 1) from public.exercises e where e.id = p_exercise;
$$;
revoke all on function public.exercise_link(uuid) from public, anon, authenticated;

-- Una entrega corregida (o con la corrección cambiada) avisa al alumno.
create or replace function public.notify_graded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text;
begin
  if new.status in ('ok', 'review') and (new.status is distinct from old.status or new.comment is distinct from old.comment) then
    select e.title into v_title from public.exercises e where e.id = new.exercise_id;
    insert into public.notifications (user_id, kind, title, link)
    values (new.user_id, 'graded',
            case when new.status = 'ok' then '✓ Bien: ' else 'Para repasar: ' end || coalesce(v_title, 'ejercicio'),
            coalesce(public.exercise_link(new.exercise_id), '/ejercicios'));
  end if;
  return new;
end; $$;
create trigger submissions_notify after update on public.submissions for each row execute function public.notify_graded();

-- Una hoja publicada avisa a todos los alumnos.
create or replace function public.notify_sheet()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    insert into public.notifications (user_id, kind, title, link)
    select p.id, 'sheet', 'Nuevos ejercicios: ' || new.title, '/ejercicios/' || new.id
    from public.profiles p where p.role = 'student';
  end if;
  return new;
end; $$;
create trigger sheets_notify after insert or update of published on public.exercise_sheets for each row execute function public.notify_sheet();

-- Soluciones publicadas: un aviso por hoja (si ya hay uno sin leer, se reaprovecha).
create or replace function public.notify_solution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sheet public.exercise_sheets;
begin
  if new.solution_published and not old.solution_published then
    select * into v_sheet from public.exercise_sheets s where s.id = new.sheet_id;
    if not v_sheet.published then return new; end if;
    update public.notifications n set created_at = now()
    where n.kind = 'solution' and n.read_at is null and n.link = '/ejercicios/' || v_sheet.id;
    insert into public.notifications (user_id, kind, title, link)
    select p.id, 'solution', 'Soluciones publicadas: ' || v_sheet.title, '/ejercicios/' || v_sheet.id
    from public.profiles p
    where p.role = 'student'
      and not exists (select 1 from public.notifications n
                      where n.user_id = p.id and n.kind = 'solution' and n.read_at is null and n.link = '/ejercicios/' || v_sheet.id);
  end if;
  return new;
end; $$;
create trigger exercises_notify after update of solution_published on public.exercises for each row execute function public.notify_solution();

-- Aviso del profe a todos los alumnos, con enlace opcional.
create or replace function public.send_notice(p_title text, p_link text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.is_teacher() then raise exception 'Solo el profesor puede enviar avisos' using errcode = '42501'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'El aviso está vacío' using errcode = '22023'; end if;
  insert into public.notifications (user_id, kind, title, link)
  select p.id, 'notice', left(trim(p_title), 300), left(coalesce(trim(p_link), ''), 500)
  from public.profiles p where p.role = 'student';
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.send_notice(text, text) from public, anon;
grant execute on function public.send_notice(text, text) to authenticated;
