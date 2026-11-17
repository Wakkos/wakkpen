-- Ejercicios: hojas que publica el profe, soluciones ocultas hasta publicarlas y entregas de los alumnos.

create table public.exercise_sheets (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null default 'Nueva hoja' check (char_length(title) between 1 and 160),
  intro               text not null default '',
  lang                text not null default 'css' check (lang in ('html', 'css', 'js')),
  published           boolean not null default false,
  created_by          uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.exercises (
  id                  uuid primary key default gen_random_uuid(),
  sheet_id            uuid not null references public.exercise_sheets (id) on delete cascade,
  position            int not null default 0,
  title               text not null default '' check (char_length(title) <= 200),
  prompt              text not null default '' check (char_length(prompt) <= 5000),
  answer_kind         text not null default 'code' check (answer_kind in ('code', 'text')),
  lang                text not null default 'css' check (lang in ('html', 'css', 'js')),
  allow_pen           boolean not null default true,
  solution_published  boolean not null default false,
  created_at          timestamptz not null default now()
);
create index exercises_sheet_idx on public.exercises (sheet_id, position);

-- La solución vive aparte para poder ocultarla por fila.
create table public.exercise_solutions (
  exercise_id         uuid primary key references public.exercises (id) on delete cascade,
  solution            text not null default '' check (char_length(solution) <= 5000)
);

create table public.submissions (
  id                  uuid primary key default gen_random_uuid(),
  exercise_id         uuid not null references public.exercises (id) on delete cascade,
  user_id             uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  answer              text not null default '' check (char_length(answer) <= 20000),
  pen_snapshot        jsonb,
  status              text not null default 'submitted' check (status in ('submitted', 'ok', 'review')),
  comment             text not null default '' check (char_length(comment) <= 2000),
  submitted_at        timestamptz not null default now(),
  graded_at           timestamptz,
  unique (exercise_id, user_id)
);
create index submissions_exercise_idx on public.submissions (exercise_id);

create trigger exercise_sheets_set_updated_at
  before update on public.exercise_sheets
  for each row execute function public.set_updated_at();

-- Ayudas
create or replace function public.sheet_is_published(p_sheet uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select published from public.exercise_sheets where id = p_sheet), false);
$$;

create or replace function public.exercise_open(p_exercise uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.exercises e join public.exercise_sheets s on s.id = e.sheet_id
    where e.id = p_exercise and s.published
  );
$$;

create or replace function public.solution_visible(p_exercise uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select solution_published from public.exercises where id = p_exercise), false);
$$;

revoke all on function public.sheet_is_published(uuid), public.exercise_open(uuid), public.solution_visible(uuid) from public, anon;
grant execute on function public.sheet_is_published(uuid), public.exercise_open(uuid), public.solution_visible(uuid) to authenticated;

-- RLS
alter table public.exercise_sheets    enable row level security;
alter table public.exercises          enable row level security;
alter table public.exercise_solutions enable row level security;
alter table public.submissions        enable row level security;
revoke all on public.exercise_sheets, public.exercises, public.exercise_solutions, public.submissions from anon;

create policy sheets_teacher on public.exercise_sheets for all to authenticated
  using ((select public.is_teacher())) with check ((select public.is_teacher()));
create policy sheets_read on public.exercise_sheets for select to authenticated using (published);

create policy exercises_teacher on public.exercises for all to authenticated
  using ((select public.is_teacher())) with check ((select public.is_teacher()));
create policy exercises_read on public.exercises for select to authenticated using (public.sheet_is_published(sheet_id));

create policy solutions_teacher on public.exercise_solutions for all to authenticated
  using ((select public.is_teacher())) with check ((select public.is_teacher()));
create policy solutions_read on public.exercise_solutions for select to authenticated
  using (public.solution_visible(exercise_id) and public.exercise_open(exercise_id));

-- Entregas: el alumno crea y edita las suyas; el profe las lee todas y corrige con grade_submission.
revoke insert, update on public.submissions from authenticated;
grant insert (exercise_id, answer, pen_snapshot) on public.submissions to authenticated;
grant update (answer, pen_snapshot, submitted_at) on public.submissions to authenticated;

create policy submissions_select on public.submissions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_teacher()));
create policy submissions_insert on public.submissions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.exercise_open(exercise_id) and not public.solution_visible(exercise_id));
create policy submissions_update on public.submissions for update to authenticated
  using (user_id = (select auth.uid()) and status = 'submitted' and not public.solution_visible(exercise_id))
  with check (user_id = (select auth.uid()));
create policy submissions_delete_teacher on public.submissions for delete to authenticated
  using ((select public.is_teacher()));

create or replace function public.grade_submission(p_submission uuid, p_status text, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_teacher() then
    raise exception 'Solo el profesor puede corregir' using errcode = '42501';
  end if;
  if p_status not in ('submitted', 'ok', 'review') then
    raise exception 'Estado no válido' using errcode = '22023';
  end if;
  update public.submissions
  set status = p_status,
      comment = coalesce(p_comment, ''),
      graded_at = case when p_status = 'submitted' then null else now() end
  where id = p_submission;
end;
$$;
revoke all on function public.grade_submission(uuid, text, text) from public, anon;
grant execute on function public.grade_submission(uuid, text, text) to authenticated;

alter publication supabase_realtime add table public.submissions;
alter publication supabase_realtime add table public.exercises;
