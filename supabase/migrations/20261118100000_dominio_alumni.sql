-- También se admiten correos @esat-alumni.com.
create or replace function public.email_allowed(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(coalesce(p_email, '')) like '%@esat.es'
      or lower(coalesce(p_email, '')) like '%@esat-alumni.com'
      or public.email_is_teacher(p_email);
$$;

create or replace function public.check_signup_domain()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and not public.email_allowed(new.email) then
    raise exception 'Solo se admiten correos de ESAT (@esat.es o @esat-alumni.com)' using errcode = '42501';
  end if;
  return new;
end; $$;
