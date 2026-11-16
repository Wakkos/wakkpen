-- Integración con GitHub: token por usuario (solo lo ve su dueño) y destino de commit por pen.

create table public.github_tokens (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  login      text not null,
  token      text not null,
  scopes     text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.github_tokens enable row level security;
revoke all on public.github_tokens from anon;

-- Sin política para el profesor: el token solo lo lee y escribe su dueño.
create policy github_tokens_own on public.github_tokens
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger github_tokens_set_updated_at
  before update on public.github_tokens
  for each row execute function public.set_updated_at();

-- Destino y último commit de cada pen.
alter table public.pens
  add column gh_repo        text check (gh_repo is null or gh_repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  add column gh_branch      text check (gh_branch is null or char_length(gh_branch) between 1 and 200),
  add column gh_path        text not null default '' check (char_length(gh_path) <= 200),
  add column gh_commit_sha  text,
  add column gh_commit_at   timestamptz,
  add column gh_pages_url   text;

grant update (gh_repo, gh_branch, gh_path, gh_commit_sha, gh_commit_at, gh_pages_url) on public.pens to authenticated;
