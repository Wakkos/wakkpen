-- Conector MCP para Claude: un enlace secreto por profesor y sugerencias de corrección que el profe confirma.
-- Pensado para pasar después a OAuth y clases: cada token pertenece a un profesor y todo lo que hace va a su nombre.

create table public.mcp_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  label         text not null default 'Claude' check (char_length(label) <= 80),
  token_hash    text not null unique,
  token_hint    text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index mcp_tokens_user_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_tokens from anon;
revoke insert, update on public.mcp_tokens from authenticated;

create policy mcp_tokens_own_select on public.mcp_tokens for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_teacher()));
create policy mcp_tokens_own_delete on public.mcp_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

-- Devuelve el token en claro una sola vez; en la base solo queda su hash.
create or replace function public.create_mcp_token(p_label text default 'Claude')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw text;
begin
  if not public.is_teacher() then
    raise exception 'Solo los profesores pueden conectar Claude' using errcode = '42501';
  end if;
  raw := 'wkp_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.mcp_tokens (user_id, label, token_hash, token_hint)
  values (auth.uid(), coalesce(nullif(trim(p_label), ''), 'Claude'), encode(extensions.digest(raw, 'sha256'), 'hex'), right(raw, 4));
  return raw;
end;
$$;
revoke all on function public.create_mcp_token(text) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;

-- Sugerencias de corrección: solo las ve el profe, nunca el alumno.
create table public.grade_suggestions (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  status        text not null check (status in ('ok', 'review')),
  comment       text not null default '' check (char_length(comment) <= 2000),
  created_at    timestamptz not null default now()
);
alter table public.grade_suggestions enable row level security;
revoke all on public.grade_suggestions from anon;
create policy grade_suggestions_teacher on public.grade_suggestions for all to authenticated
  using ((select public.is_teacher())) with check ((select public.is_teacher()));

alter publication supabase_realtime add table public.grade_suggestions;
