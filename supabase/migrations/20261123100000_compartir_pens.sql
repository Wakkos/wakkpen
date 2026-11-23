-- Pens del profe compartidos con una sesión: los ven sus alumnos (y coprofes) y pueden hacer un fork.
-- Un pen de profe unido a una sesión de la que es profe queda compartido con ella.

create or replace function public.pen_shared_with_me(p_owner uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_session is not null
     and exists (select 1 from public.session_teachers t where t.session_id = p_session and t.user_id = p_owner)
     and public.is_session_member(p_session);
$$;

create or replace function public.can_view_pen(p_pen uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pens p
    where p.id = p_pen
      and (p.owner_id = auth.uid() or public.can_view_pens_of(p.owner_id) or public.pen_shared_with_me(p.owner_id, p.session_id))
  );
$$;

revoke all on function public.pen_shared_with_me(uuid, uuid) from public, anon;
grant execute on function public.pen_shared_with_me(uuid, uuid) to authenticated;

drop policy pens_select on public.pens;
create policy pens_select on public.pens for select to authenticated
  using (owner_id = (select auth.uid()) or public.can_view_pens_of(owner_id) or public.pen_shared_with_me(owner_id, session_id));

drop policy pen_files_select on public.pen_files;
create policy pen_files_select on public.pen_files for select to authenticated
  using (owner_id = (select auth.uid()) or public.can_view_pen(pen_id));

-- Fork: copia de un pen que puedo ver, a mi nombre. Si estoy en su sesión, la copia queda en ella.
create or replace function public.fork_pen(p_pen uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare src public.pens; new_id uuid;
begin
  select * into src from public.pens where id = p_pen;
  if src.id is null or not public.can_view_pen(p_pen) then
    raise exception 'No puedes copiar este pen' using errcode = '42501';
  end if;
  insert into public.pens (owner_id, title, html, css, css_lang, js, libs, session_id)
  values (
    auth.uid(), left('Copia de ' || src.title, 120), src.html, src.css, src.css_lang, src.js, src.libs,
    case when src.session_id is not null and public.is_session_member(src.session_id) then src.session_id end
  )
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.fork_pen(uuid) from public, anon;
grant execute on function public.fork_pen(uuid) to authenticated;
