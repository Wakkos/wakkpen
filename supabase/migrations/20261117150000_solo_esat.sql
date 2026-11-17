-- Solo se dan de alta correos @esat.es (y los profes de la lista teacher_email, tengan el dominio que tengan).
-- Las cuentas que ya existen no se tocan.

create or replace function public.email_allowed(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(coalesce(p_email, '')) like '%@esat.es' or public.email_is_teacher(p_email);
$$;
revoke all on function public.email_allowed(text) from public, anon, authenticated;

create or replace function public.check_signup_domain()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and not public.email_allowed(new.email) then
    raise exception 'Solo se admiten correos @esat.es' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger check_signup_domain
  before insert on auth.users
  for each row execute function public.check_signup_domain();

create trigger check_email_change_domain
  before update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.check_signup_domain();
