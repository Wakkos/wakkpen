-- Cada ejercicio es un pen pequeño: su HTML y su CSS, y el profe decide qué partes puede editar el alumno.
-- Sustituye al modelo anterior (lenguaje de respuesta + base aparte). Sin JavaScript en los ejercicios.

-- Ejercicios
alter table public.exercises rename column base_html to html;
alter table public.exercises rename column base_css to css;
alter table public.exercises
  add column edit_html   boolean not null default false,
  add column edit_css    boolean not null default true,
  add column text_answer boolean not null default false;

update public.exercises set
  text_answer = (answer_kind = 'text'),
  edit_html   = (answer_kind = 'code' and lang = 'html'),
  edit_css    = (answer_kind = 'code' and lang <> 'html');

alter table public.exercises drop column answer_kind, drop column lang, drop column allow_pen;
alter table public.exercise_sheets drop column lang;

-- Soluciones: HTML y CSS completos de la parte editable; "solution" queda como nota o explicación.
alter table public.exercise_solutions
  add column html text not null default '' check (char_length(html) <= 50000),
  add column css  text not null default '' check (char_length(css) <= 50000);

-- Entregas: lo que tiene el alumno en cada editor; "answer" es la respuesta escrita.
alter table public.submissions drop column pen_snapshot;
alter table public.submissions
  add column answer_html text not null default '' check (char_length(answer_html) <= 50000),
  add column answer_css  text not null default '' check (char_length(answer_css) <= 50000);

grant insert (answer_html, answer_css) on public.submissions to authenticated;
grant update (answer_html, answer_css) on public.submissions to authenticated;
