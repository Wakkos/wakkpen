-- Aula: varios profesores, levantar la mano, librerías por pen, enlace en vivo para el móvil e historial.

-- 1. Varios profesores: settings.teacher_email admite una lista separada por comas.
create or replace function public.email_is_teacher(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.settings s, unnest(string_to_array(s.value, ',')) as t(email)
    where s.key = 'teacher_email'
      and trim(t.email) <> ''
      and lower(trim(t.email)) = lower(coalesce(p_email, ''))
  );
$$;
revoke all on function public.email_is_teacher(text) from public, anon, authenticated;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.email_is_teacher(auth.jwt() ->> 'email');
$$;

create or replace function public.role_for_email(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.email_is_teacher(p_email) then 'teacher' else 'student' end;
$$;

-- 2. Levantar la mano.
alter table public.profiles add column hand_raised_at timestamptz;
grant update (hand_raised_at) on public.profiles to authenticated;

create or replace function public.lower_hand(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_teacher() then
    raise exception 'Solo el profesor puede bajar la mano de un alumno' using errcode = '42501';
  end if;
  update public.profiles set hand_raised_at = null where id = p_user;
end;
$$;
revoke all on function public.lower_hand(uuid) from public, anon;
grant execute on function public.lower_hand(uuid) to authenticated;

alter publication supabase_realtime add table public.profiles;

-- 3. Librerías externas por pen.
alter table public.pens add column libs text[] not null default '{}' check (cardinality(libs) <= 20);
grant update (libs) on public.pens to authenticated;

-- 4. Enlace en vivo para el móvil: un token secreto por pen.
alter table public.pens add column live_token uuid not null default gen_random_uuid();
create unique index pens_live_token_idx on public.pens (live_token);

create or replace function public.get_live_pen(p_token uuid)
returns table (title text, html text, css text, css_lang text, js text, libs text[])
language sql
stable
security definer
set search_path = ''
as $$
  select p.title, p.html, p.css, p.css_lang, p.js, p.libs from public.pens p where p.live_token = p_token;
$$;
revoke all on function public.get_live_pen(uuid) from public;
grant execute on function public.get_live_pen(uuid) to anon, authenticated;

create or replace function public.regenerate_live_token(p_pen uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid := gen_random_uuid();
begin
  update public.pens set live_token = t where id = p_pen and owner_id = auth.uid();
  if not found then
    raise exception 'Pen no encontrado' using errcode = 'P0002';
  end if;
  return t;
end;
$$;
revoke all on function public.regenerate_live_token(uuid) from public, anon;
grant execute on function public.regenerate_live_token(uuid) to authenticated;

-- 5. Historial: también guarda el lenguaje de estilos.
alter table public.pen_snapshots add column css_lang text not null default 'css' check (css_lang in ('css', 'scss'));
