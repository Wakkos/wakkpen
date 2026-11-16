-- Esquema base: ajustes, perfiles, pens, archivos y snapshots.

create extension if not exists pgcrypto with schema extensions;

-- settings: solo accesible desde SQL o funciones security definer.
create table public.settings (
  key   text primary key,
  value text not null default ''
);

insert into public.settings (key, value) values ('teacher_email', '')
on conflict (key) do nothing;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.settings s
    where s.key = 'teacher_email'
      and s.value <> ''
      and lower(s.value) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_teacher() from public, anon;
grant execute on function public.is_teacher() to authenticated;

-- profiles
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  nombre     text not null default '',
  role       text not null default 'student' check (role in ('student', 'teacher')),
  created_at timestamptz not null default now()
);

create or replace function public.role_for_email(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.settings s
      where s.key = 'teacher_email'
        and s.value <> ''
        and lower(s.value) = lower(p_email)
    ) then 'teacher'
    else 'student'
  end;
$$;

revoke all on function public.role_for_email(text) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, nombre, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'nombre', ''), split_part(new.email, '@', 1)),
    public.role_for_email(new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email,
      role  = public.role_for_email(new.email)
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Al cambiar el email del profesor en settings, se recalcula role en todos los perfiles.
create or replace function public.sync_teacher_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key = 'teacher_email' then
    update public.profiles set role = public.role_for_email(email);
  end if;
  return null;
end;
$$;

create trigger on_settings_changed
  after insert or update on public.settings
  for each row execute function public.sync_teacher_role();

-- pens
create table public.pens (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title      text not null default 'Sin título' check (char_length(title) between 1 and 120),
  html       text not null default '' check (char_length(html) <= 200000),
  css        text not null default '' check (char_length(css) <= 200000),
  css_lang   text not null default 'css' check (css_lang in ('css', 'scss')),
  js         text not null default '' check (char_length(js) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pens_owner_updated_idx on public.pens (owner_id, updated_at desc);
create index pens_updated_idx on public.pens (updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pens_set_updated_at
  before update on public.pens
  for each row execute function public.set_updated_at();

-- pen_files: metadatos de lo subido a Storage. Tamaño y mime se copian del objeto real.
create table public.pen_files (
  id         uuid primary key default gen_random_uuid(),
  pen_id     uuid not null references public.pens (id) on delete cascade,
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  path       text not null unique,
  name       text not null check (char_length(name) between 1 and 200),
  size       bigint not null default 0,
  mime       text not null default '',
  created_at timestamptz not null default now(),
  constraint pen_files_path_prefix check (path like owner_id::text || '/' || pen_id::text || '/%')
);

create index pen_files_pen_idx on public.pen_files (pen_id);
create index pen_files_owner_idx on public.pen_files (owner_id);

-- pen_snapshots: preparada para el historial de la fase 2, sin UI.
create table public.pen_snapshots (
  id         uuid primary key default gen_random_uuid(),
  pen_id     uuid not null references public.pens (id) on delete cascade,
  html       text not null default '',
  css        text not null default '',
  js         text not null default '',
  created_at timestamptz not null default now()
);

create index pen_snapshots_pen_idx on public.pen_snapshots (pen_id, created_at desc);
