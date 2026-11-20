-- Sesiones: cada profe crea las suyas, los alumnos se unen con un enlace y cada profe ve
-- solo lo de los alumnos de sus sesiones. Una sesión larga hace de "clase"; una corta, de clase del día.
--   · Hojas: son de quien las crea y se asignan a sesiones; las gestionan su autor y los profes
--     de las sesiones a las que están asignadas. Los alumnos siguen viendo todas las publicadas.
--   · Pens: el alumno puede unir un pen a una sesión; el muro del profe muestra la sesión activa.
--   · Invitados: una sesión puede admitir correos de fuera de ESAT que entren por su enlace.

-- ---------- Tablas ----------
create table public.sessions (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  title          text not null check (char_length(title) between 1 and 120),
  owner_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  is_open        boolean not null default true,   -- admite gente nueva por el enlace
  guests_allowed boolean not null default false,  -- admite correos de fuera de ESAT
  archived       boolean not null default false,
  created_at     timestamptz not null default now()
);

create table public.session_teachers (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (session_id, user_id)
);

create table public.session_members (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index session_members_user_idx on public.session_members (user_id);

create table public.session_sheets (
  session_id uuid not null references public.sessions (id) on delete cascade,
  sheet_id   uuid not null references public.exercise_sheets (id) on delete cascade,
  primary key (session_id, sheet_id)
);
create index session_sheets_sheet_idx on public.session_sheets (sheet_id);

-- Correos de fuera de ESAT autorizados a darse de alta por el enlace de una sesión.
create table public.session_guests (
  session_id uuid not null references public.sessions (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, email)
);

alter table public.pens add column session_id uuid references public.sessions (id) on delete set null;
create index pens_session_idx on public.pens (session_id);

-- ---------- Funciones de permisos ----------
create or replace function public.is_session_teacher(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.session_teachers t where t.session_id = p_session and t.user_id = auth.uid());
$$;

create or replace function public.is_session_member(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.session_members m where m.session_id = p_session and m.user_id = auth.uid())
      or public.is_session_teacher(p_session);
$$;

-- El usuario está en alguna sesión de la que soy profe.
create or replace function public.teaches_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.session_members m
    join public.session_teachers t on t.session_id = m.session_id
    where m.user_id = p_user and t.user_id = auth.uid()
  );
$$;

-- Alumno sin ninguna sesión (recién dado de alta): lo ven todos los profes para poder borrarlo.
create or replace function public.has_no_session(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.session_members m where m.user_id = p_user);
$$;

create or replace function public.can_view_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid()
      or (public.is_teacher() and (public.teaches_user(p_user) or public.has_no_session(p_user)));
$$;

-- Ver los pens y su historial: el dueño o un profe de una de sus sesiones.
create or replace function public.can_view_pens_of(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid() or (public.is_teacher() and public.teaches_user(p_user));
$$;

-- Para Storage: la carpeta es el id del dueño (texto); si no es un uuid, no hay acceso.
create or replace function public.can_view_files_of(p_folder text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_folder !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  return public.can_view_pens_of(p_folder::uuid);
end; $$;

create or replace function public.can_view_pen(p_pen uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pens p where p.id = p_pen and public.can_view_pens_of(p.owner_id));
$$;

-- Gestionar una hoja: su autor o un profe de una sesión a la que está asignada.
create or replace function public.can_manage_sheet(p_sheet uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_teacher() and (
    exists (select 1 from public.exercise_sheets s where s.id = p_sheet and s.created_by = auth.uid())
    or exists (
      select 1 from public.session_sheets ss
      join public.session_teachers t on t.session_id = ss.session_id
      where ss.sheet_id = p_sheet and t.user_id = auth.uid()
    )
  );
$$;

create or replace function public.can_manage_exercise(p_exercise uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.exercises e where e.id = p_exercise and public.can_manage_sheet(e.sheet_id));
$$;

create or replace function public.can_manage_submission(p_submission uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.submissions s where s.id = p_submission and public.can_manage_exercise(s.exercise_id));
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'is_session_teacher(uuid)', 'is_session_member(uuid)', 'teaches_user(uuid)', 'has_no_session(uuid)',
    'can_view_user(uuid)', 'can_view_pens_of(uuid)', 'can_view_files_of(text)', 'can_view_pen(uuid)', 'can_manage_sheet(uuid)',
    'can_manage_exercise(uuid)', 'can_manage_submission(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- RLS de sesiones ----------
alter table public.sessions         enable row level security;
alter table public.session_teachers enable row level security;
alter table public.session_members  enable row level security;
alter table public.session_sheets   enable row level security;
alter table public.session_guests   enable row level security;
revoke all on public.sessions, public.session_teachers, public.session_members, public.session_sheets, public.session_guests from anon;
revoke all on public.session_guests from authenticated;

-- Las sesiones se crean con create_session; los profes de la sesión cambian título y estado.
revoke insert, update on public.sessions from authenticated;
grant update (title, is_open, guests_allowed, archived) on public.sessions to authenticated;
create policy sessions_select on public.sessions for select to authenticated using (public.is_session_member(id));
create policy sessions_update on public.sessions for update to authenticated
  using (public.is_session_teacher(id)) with check (public.is_session_teacher(id));
create policy sessions_delete on public.sessions for delete to authenticated using (owner_id = auth.uid());

-- Profes y miembros solo cambian por funciones.
revoke insert, update, delete on public.session_teachers, public.session_members from authenticated;
create policy session_teachers_select on public.session_teachers for select to authenticated
  using (public.is_session_member(session_id));
create policy session_members_select on public.session_members for select to authenticated
  using (user_id = auth.uid() or public.is_session_teacher(session_id));

revoke update on public.session_sheets from authenticated;
create policy session_sheets_select on public.session_sheets for select to authenticated
  using (public.is_session_member(session_id));
create policy session_sheets_insert on public.session_sheets for insert to authenticated
  with check (public.is_session_teacher(session_id) and public.can_manage_sheet(sheet_id));
create policy session_sheets_delete on public.session_sheets for delete to authenticated
  using (public.is_session_teacher(session_id));

-- ---------- Funciones de sesiones ----------
create or replace function public.new_session_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.sessions s where s.code = c);
  end loop;
  return c;
end; $$;
revoke all on function public.new_session_code() from public, anon, authenticated;

create or replace function public.create_session(p_title text)
returns public.sessions language plpgsql security definer set search_path = '' as $$
declare s public.sessions;
begin
  if not public.is_teacher() then raise exception 'Solo los profesores crean sesiones' using errcode = '42501'; end if;
  insert into public.sessions (code, title, owner_id)
  values (public.new_session_code(), coalesce(nullif(trim(p_title), ''), 'Nueva sesión'), auth.uid())
  returning * into s;
  insert into public.session_teachers (session_id, user_id) values (s.id, auth.uid());
  return s;
end; $$;

-- Lo que se ve antes de entrar: título y si admite gente de fuera de ESAT.
create or replace function public.session_preview(p_code text)
returns table (title text, is_open boolean, guests_allowed boolean)
language sql stable security definer set search_path = '' as $$
  select s.title, s.is_open and not s.archived, s.guests_allowed
  from public.sessions s where s.code = upper(trim(p_code));
$$;

-- Autoriza un correo de fuera de ESAT a darse de alta, solo si la sesión lo permite.
create or replace function public.request_guest_access(p_code text, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.sessions; e text := lower(trim(coalesce(p_email, '')));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return false; end if;
  select * into s from public.sessions where code = upper(trim(p_code));
  if s.id is null or not s.is_open or s.archived or not s.guests_allowed then return false; end if;
  insert into public.session_guests (session_id, email) values (s.id, e) on conflict do nothing;
  return true;
end; $$;

create or replace function public.join_session(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.sessions;
begin
  select * into s from public.sessions where code = upper(trim(p_code));
  if s.id is null then raise exception 'No existe ninguna sesión con ese código' using errcode = 'P0002'; end if;
  if public.is_session_member(s.id) then return s.id; end if;
  if not s.is_open or s.archived then raise exception 'Esta sesión ya no admite gente nueva' using errcode = '42501'; end if;
  if public.is_teacher() then
    raise exception 'Eres profesor: pide a quien la creó que te añada como profe de la sesión' using errcode = '42501';
  end if;
  insert into public.session_members (session_id, user_id) values (s.id, auth.uid()) on conflict do nothing;
  return s.id;
end; $$;

create or replace function public.leave_session(p_session uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.session_members where session_id = p_session and user_id = auth.uid();
  update public.pens set session_id = null where session_id = p_session and owner_id = auth.uid();
$$;

create or replace function public.add_session_teacher(p_session uuid, p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if not public.is_session_teacher(p_session) then raise exception 'No eres profe de esta sesión' using errcode = '42501'; end if;
  select * into p from public.profiles where lower(email) = lower(trim(p_email));
  if p.id is null then raise exception 'Ese correo aún no ha entrado en Wakkpen' using errcode = 'P0002'; end if;
  if p.role <> 'teacher' then raise exception 'Ese correo no está en la lista de profesores' using errcode = '42501'; end if;
  insert into public.session_teachers (session_id, user_id) values (p_session, p.id) on conflict do nothing;
  delete from public.session_members where session_id = p_session and user_id = p.id;
  return p.nombre;
end; $$;

-- Quita a un alumno o a un coprofe (nunca al dueño).
create or replace function public.remove_from_session(p_session uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_session_teacher(p_session) then raise exception 'No eres profe de esta sesión' using errcode = '42501'; end if;
  if exists (select 1 from public.sessions s where s.id = p_session and s.owner_id = p_user) then
    raise exception 'No se puede quitar a quien creó la sesión' using errcode = '42501';
  end if;
  delete from public.session_members where session_id = p_session and user_id = p_user;
  delete from public.session_teachers where session_id = p_session and user_id = p_user;
  update public.pens set session_id = null where session_id = p_session and owner_id = p_user;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['create_session(text)', 'join_session(text)', 'leave_session(uuid)',
                           'add_session_teacher(uuid, text)', 'remove_from_session(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.session_preview(text) from public;
grant execute on function public.session_preview(text) to anon, authenticated;
revoke all on function public.request_guest_access(text, text) from public;
grant execute on function public.request_guest_access(text, text) to anon, authenticated;

-- Un pen solo se une a una sesión de la que su dueño forma parte.
create or replace function public.check_pen_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.session_id is not null and not (
    exists (select 1 from public.session_members m where m.session_id = new.session_id and m.user_id = new.owner_id)
    or exists (select 1 from public.session_teachers t where t.session_id = new.session_id and t.user_id = new.owner_id)
  ) then
    raise exception 'No estás en esa sesión' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger pens_check_session before insert or update of session_id on public.pens
  for each row execute function public.check_pen_session();
grant update (session_id) on public.pens to authenticated;

-- Alta: ESAT, profes de la lista o invitados de una sesión abierta a gente de fuera.
create or replace function public.email_allowed(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(coalesce(p_email, '')) like '%@esat.es'
      or lower(coalesce(p_email, '')) like '%@esat-alumni.com'
      or public.email_is_teacher(p_email)
      or exists (select 1 from public.session_guests g where g.email = lower(trim(p_email)));
$$;

-- ---------- Permisos que pasan de "cualquier profe" a "profe de sus sesiones" ----------
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (role = 'teacher' or public.can_view_user(id));

drop policy pens_select on public.pens;
create policy pens_select on public.pens for select to authenticated
  using (owner_id = (select auth.uid()) or public.can_view_pens_of(owner_id));

drop policy pen_files_select on public.pen_files;
create policy pen_files_select on public.pen_files for select to authenticated
  using (owner_id = (select auth.uid()) or public.can_view_pens_of(owner_id));

drop policy pen_snapshots_select on public.pen_snapshots;
create policy pen_snapshots_select on public.pen_snapshots for select to authenticated
  using (public.can_view_pen(pen_id));

drop policy pen_assets_select on storage.objects;
create policy pen_assets_select on storage.objects for select to authenticated
  using (
    bucket_id = 'pen-assets'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.can_view_files_of((storage.foldername(name))[1])
    )
  );

drop policy sheets_teacher on public.exercise_sheets;
create policy sheets_manage on public.exercise_sheets for all to authenticated
  using (((select public.is_teacher()) and created_by = auth.uid()) or public.can_manage_sheet(id))
  with check ((select public.is_teacher()) and (created_by = auth.uid() or public.can_manage_sheet(id)));

drop policy exercises_teacher on public.exercises;
create policy exercises_manage on public.exercises for all to authenticated
  using (public.can_manage_sheet(sheet_id)) with check (public.can_manage_sheet(sheet_id));

drop policy solutions_teacher on public.exercise_solutions;
create policy solutions_manage on public.exercise_solutions for all to authenticated
  using (public.can_manage_exercise(exercise_id)) with check (public.can_manage_exercise(exercise_id));

drop policy submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_exercise(exercise_id));
drop policy submissions_delete_teacher on public.submissions;
create policy submissions_delete_teacher on public.submissions for delete to authenticated
  using (public.can_manage_exercise(exercise_id));

drop policy grade_suggestions_teacher on public.grade_suggestions;
create policy grade_suggestions_manage on public.grade_suggestions for all to authenticated
  using (public.can_manage_submission(submission_id)) with check (public.can_manage_submission(submission_id));

create or replace function public.grade_submission(p_submission uuid, p_status text, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_submission(p_submission) then
    raise exception 'Solo los profes de esta hoja pueden corregir' using errcode = '42501';
  end if;
  if p_status not in ('submitted', 'ok', 'review') then raise exception 'Estado no válido' using errcode = '22023'; end if;
  update public.submissions
  set status = p_status, comment = coalesce(p_comment, ''),
      graded_at = case when p_status = 'submitted' then null else now() end,
      graded_by = case when p_status = 'submitted' then null else 'teacher' end
  where id = p_submission;
end; $$;

create or replace function public.lower_hand(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_teacher() and public.teaches_user(p_user)) and p_user <> auth.uid() then
    raise exception 'Solo un profe de sus sesiones puede bajarle la mano' using errcode = '42501';
  end if;
  update public.profiles set hand_raised_at = null where id = p_user;
end; $$;

-- Borrar usuarios (función delete-user): alumnos de mis sesiones o sin sesión.
create or replace function public.can_delete_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_teacher() and p_user <> auth.uid()
     and exists (select 1 from public.profiles p where p.id = p_user and p.role = 'student')
     and (public.teaches_user(p_user) or public.has_no_session(p_user));
$$;
revoke all on function public.can_delete_user(uuid) from public, anon;
grant execute on function public.can_delete_user(uuid) to authenticated;

-- ---------- Notificaciones por sesión ----------
-- Destinatarios de una hoja: los miembros de sus sesiones; si no está en ninguna, todos los alumnos.
create or replace function public.sheet_recipients(p_sheet uuid)
returns table (user_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct m.user_id from public.session_members m
  join public.session_sheets ss on ss.session_id = m.session_id
  where ss.sheet_id = p_sheet
  union
  select p.id from public.profiles p
  where p.role = 'student' and not exists (select 1 from public.session_sheets ss where ss.sheet_id = p_sheet);
$$;
revoke all on function public.sheet_recipients(uuid) from public, anon, authenticated;

create or replace function public.notify_sheet()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    insert into public.notifications (user_id, kind, title, link)
    select r.user_id, 'sheet', 'Nuevos ejercicios: ' || new.title, '/ejercicios/' || new.id
    from public.sheet_recipients(new.id) r;
  end if;
  return new;
end; $$;

-- Una hoja ya publicada que se asigna a otra sesión avisa a los miembros de esa sesión.
create or replace function public.notify_sheet_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.exercise_sheets;
begin
  select * into s from public.exercise_sheets where id = new.sheet_id;
  if s.published then
    insert into public.notifications (user_id, kind, title, link)
    select m.user_id, 'sheet', 'Nuevos ejercicios: ' || s.title, '/ejercicios/' || s.id
    from public.session_members m where m.session_id = new.session_id;
  end if;
  return new;
end; $$;
create trigger session_sheets_notify after insert on public.session_sheets
  for each row execute function public.notify_sheet_assigned();

create or replace function public.notify_solution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sheet public.exercise_sheets; v_link text;
begin
  if new.solution_published and not old.solution_published then
    select * into v_sheet from public.exercise_sheets s where s.id = new.sheet_id;
    if not v_sheet.published then return new; end if;
    v_link := '/ejercicios/' || v_sheet.id;
    update public.notifications n set created_at = now()
    where n.kind = 'solution' and n.read_at is null and n.link = v_link;
    insert into public.notifications (user_id, kind, title, link)
    select r.user_id, 'solution', 'Soluciones publicadas: ' || v_sheet.title, v_link
    from public.sheet_recipients(v_sheet.id) r
    where not exists (select 1 from public.notifications n
                      where n.user_id = r.user_id and n.kind = 'solution' and n.read_at is null and n.link = v_link);
  end if;
  return new;
end; $$;

-- Avisos del profe: a los miembros de una sesión suya.
drop function public.send_notice(text, text);
create or replace function public.send_notice(p_session uuid, p_title text, p_link text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.is_session_teacher(p_session) then raise exception 'No eres profe de esta sesión' using errcode = '42501'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'El aviso está vacío' using errcode = '22023'; end if;
  insert into public.notifications (user_id, kind, title, link)
  select m.user_id, 'notice', left(trim(p_title), 300), left(coalesce(trim(p_link), ''), 500)
  from public.session_members m where m.session_id = p_session;
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.send_notice(uuid, text, text) from public, anon;
grant execute on function public.send_notice(uuid, text, text) to authenticated;

-- ---------- Tiempo real ----------
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.session_members;
alter publication supabase_realtime add table public.session_sheets;

-- ---------- Lo que ya había pasa a una sesión "Frontend UI 26/27" ----------
do $$
declare v_owner uuid; v_session uuid;
begin
  select s.created_by into v_owner from public.exercise_sheets s
  join public.profiles p on p.id = s.created_by and p.role = 'teacher'
  order by s.created_at limit 1;
  if v_owner is null then
    select id into v_owner from public.profiles where role = 'teacher' order by created_at limit 1;
  end if;
  if v_owner is null then return; end if;

  update public.exercise_sheets set created_by = v_owner where created_by is null;
  insert into public.sessions (code, title, owner_id) values (public.new_session_code(), 'Frontend UI 26/27', v_owner)
  returning id into v_session;
  insert into public.session_teachers (session_id, user_id)
  select v_session, id from public.profiles where role = 'teacher';
  insert into public.session_members (session_id, user_id)
  select v_session, id from public.profiles where role = 'student';
  insert into public.session_sheets (session_id, sheet_id) select v_session, id from public.exercise_sheets;
  update public.pens set session_id = v_session where owner_id in (select id from public.profiles where role = 'student');
  -- Las hojas asignadas aquí ya estaban publicadas: no se vuelve a avisar.
  delete from public.notifications where kind = 'sheet' and created_at = now();
end $$;
