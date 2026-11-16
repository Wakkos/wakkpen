-- Bucket pen-assets: público para lectura por URL, 2 MB por archivo, tipos cerrados, máximo 10 archivos por usuario.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pen-assets',
  'pen-assets',
  true,
  2097152,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'font/woff',
    'font/woff2',
    'application/json'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Cuota por número de archivos: el tamaño no es fiable en el insert (Storage lo rellena después).
-- 10 archivos x 2 MB = 20 MB como máximo por usuario.
create or replace function public.storage_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from storage.objects o
  where o.bucket_id = 'pen-assets'
    and o.name like p_user::text || '/%';
$$;

revoke all on function public.storage_count(uuid) from public, anon;
grant execute on function public.storage_count(uuid) to authenticated;

create or replace function public.owns_pen_text(p_pen_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pens p
    where p.id::text = p_pen_id and p.owner_id = auth.uid()
  );
$$;

revoke all on function public.owns_pen_text(text) from public, anon;
grant execute on function public.owns_pen_text(text) to authenticated;

-- Ruta obligatoria {user_id}/{pen_id}/{archivo}, pen propio y máximo 10 archivos.
-- Sin política de update: no se sobrescriben archivos, así la cuota no se puede esquivar con upsert.
create policy pen_assets_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pen-assets'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.owns_pen_text((storage.foldername(name))[2])
    and public.storage_count((select auth.uid())) < 10
  );

create policy pen_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pen-assets'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_teacher())
    )
  );

create policy pen_assets_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pen-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- pen_files toma tamaño y mime del objeto real; si el objeto no existe, no se registra.
create or replace function public.fill_pen_file_from_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj record;
begin
  select o.metadata into obj
  from storage.objects o
  where o.bucket_id = 'pen-assets' and o.name = new.path;

  if not found then
    raise exception 'El archivo % no existe en Storage', new.path using errcode = 'P0002';
  end if;

  new.size := coalesce((obj.metadata ->> 'size')::bigint, 0);
  new.mime := coalesce(obj.metadata ->> 'mimetype', '');
  return new;
end;
$$;

create trigger pen_files_fill_from_object
  before insert on public.pen_files
  for each row execute function public.fill_pen_file_from_object();
