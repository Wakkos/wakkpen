-- RLS: el alumno lee y escribe lo suyo; el profesor lee todo y no edita lo ajeno.

alter table public.settings      enable row level security;
alter table public.profiles      enable row level security;
alter table public.pens          enable row level security;
alter table public.pen_files     enable row level security;
alter table public.pen_snapshots enable row level security;

-- settings: sin políticas, así que ni anon ni authenticated pueden leerla ni tocarla.
revoke all on public.settings from anon, authenticated;

create or replace function public.owns_pen(p_pen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pens p
    where p.id = p_pen_id and p.owner_id = auth.uid()
  );
$$;

revoke all on function public.owns_pen(uuid) from public, anon;
grant execute on function public.owns_pen(uuid) to authenticated;

-- profiles: lectura propia o del profesor; el usuario solo puede cambiar su nombre.
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant update (nombre) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_teacher()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- pens
revoke all on public.pens from anon;
revoke update on public.pens from authenticated;
grant update (title, html, css, css_lang, js) on public.pens to authenticated;

create policy pens_select on public.pens
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_teacher()));

create policy pens_insert_own on public.pens
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy pens_update_own on public.pens
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy pens_delete_own on public.pens
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- pen_files: inmutables; se crean y se borran.
revoke all on public.pen_files from anon;
revoke update on public.pen_files from authenticated;

create policy pen_files_select on public.pen_files
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_teacher()));

create policy pen_files_insert_own on public.pen_files
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.owns_pen(pen_id));

create policy pen_files_delete_own on public.pen_files
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- pen_snapshots: el dueño se deduce del pen.
revoke all on public.pen_snapshots from anon;
revoke update on public.pen_snapshots from authenticated;

create policy pen_snapshots_select on public.pen_snapshots
  for select to authenticated
  using (public.owns_pen(pen_id) or (select public.is_teacher()));

create policy pen_snapshots_insert_own on public.pen_snapshots
  for insert to authenticated
  with check (public.owns_pen(pen_id));

create policy pen_snapshots_delete_own on public.pen_snapshots
  for delete to authenticated
  using (public.owns_pen(pen_id));
