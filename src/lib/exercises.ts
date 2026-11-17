import { supabase } from './supabase'

export type SubStatus = 'submitted' | 'ok' | 'review'

export interface Sheet {
  id: string
  title: string
  intro: string
  published: boolean
  created_at: string
  updated_at: string
}

// Cada ejercicio es un pen pequeño: su HTML y su CSS. El profe decide qué partes puede editar el alumno.
export interface Exercise {
  id: string
  sheet_id: string
  position: number
  title: string
  prompt: string
  html: string
  css: string
  edit_html: boolean
  edit_css: boolean
  text_answer: boolean
  show_preview: boolean
  solution_published: boolean
}

export interface Solution {
  exercise_id: string
  html: string
  css: string
  solution: string // nota o explicación
}

export interface Submission {
  id: string
  exercise_id: string
  user_id: string
  answer: string // respuesta escrita
  answer_html: string
  answer_css: string
  status: SubStatus
  comment: string
  submitted_at: string
  graded_at: string | null
  graded_by: 'teacher' | 'claude' | null
}

// Borrador de ejercicio en el editor del profe (antes de guardar).
export interface DraftExercise extends Omit<Exercise, 'id' | 'sheet_id' | 'position'> {
  id?: string
  key: string
  solution: string
  solution_html: string
  solution_css: string
}

let seq = 0
export const newKey = () => `k${Date.now().toString(36)}${seq++}`

export function blankExercise(): DraftExercise {
  return {
    key: newKey(),
    title: '',
    prompt: '',
    html: '',
    css: '',
    edit_html: false,
    edit_css: true,
    text_answer: false,
    show_preview: false,
    solution_published: false,
    solution: '',
    solution_html: '',
    solution_css: '',
  }
}

// ---------- Importar texto ----------
// Formato esperado (flexible):
//   1 · Título
//   Enunciado (una o varias líneas)
//   Solución (última línea del bloque)
//   Extra …: enunciado (solución entre paréntesis al final)
// Lo que va antes del primer encabezado se toma como introducción.

const HEADER = /^\s*(\d{1,2})\s*[·.)\-–:]\s*(.+)$/
const EXTRA = /^\s*(extra[^:]*):\s*(.*)$/i

export function parseExercises(text: string): { intro: string; exercises: DraftExercise[]; ignored: string } {
  const lines = text.replace(/\r/g, '').split('\n')
  const intro: string[] = []
  const blocks: { title: string; body: string[] }[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = line.match(HEADER)
    const x = !h && line.match(EXTRA)
    if (h) blocks.push({ title: h[2].trim(), body: [] })
    else if (x) blocks.push({ title: x[1].trim(), body: x[2] ? [x[2]] : [] })
    else if (blocks.length) blocks[blocks.length - 1].body.push(line)
    else intro.push(line)
  }

  const ignored: string[] = []
  const exercises = blocks.map(({ title, body }) => {
    const b = body.map((l) => l.trim()).filter(Boolean)
    let prompt = b.join('\n')
    let solution = ''
    const paren = b[0]?.match(/^(.*?)\s*\(([^()]+)\)\s*\.?$/) // solución entre paréntesis al final de la primera línea
    if (paren && b[0].length > 40) {
      prompt = paren[1].trim()
      solution = paren[2].trim()
      ignored.push(...b.slice(1)) // lo que viene después suele ser una nota para el profe
    } else if (b.length >= 2) {
      solution = b[b.length - 1]
      prompt = b.slice(0, -1).join('\n')
    }
    const isText = /[¿?]/.test(title + prompt) && !/[{}]/.test(solution)
    const code = solutionCode(solution)
    const isHtml = /<[a-z!]/i.test(code) && !/[{}]/.test(code)
    return {
      ...blankExercise(),
      title,
      prompt,
      solution: isText ? solution : code === solution ? '' : solution,
      text_answer: isText,
      edit_css: !isText && !isHtml,
      edit_html: !isText && isHtml,
      solution_css: !isText && !isHtml ? code : '',
      solution_html: !isText && isHtml ? code : '',
    }
  })

  return { intro: intro.join('\n').trim(), exercises, ignored: ignored.join('\n') }
}

// ---------- Texto con `código` ----------
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function richText(text: string): string {
  return text
    .split(/\n{1,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`)
    .join('')
}

// ---------- Guardado del profe ----------
export async function saveSheet(sheet: Sheet, drafts: DraftExercise[], removed: string[]): Promise<DraftExercise[]> {
  const { error: sErr } = await supabase
    .from('exercise_sheets')
    .update({ title: sheet.title, intro: sheet.intro, published: sheet.published })
    .eq('id', sheet.id)
  if (sErr) throw sErr

  if (removed.length) {
    const { error } = await supabase.from('exercises').delete().in('id', removed)
    if (error) throw error
  }

  const saved: DraftExercise[] = []
  for (const [i, d] of drafts.entries()) {
    const row = {
      sheet_id: sheet.id,
      position: i,
      title: d.title,
      prompt: d.prompt,
      html: d.html,
      css: d.css,
      edit_html: d.edit_html,
      edit_css: d.edit_css,
      text_answer: d.text_answer,
      show_preview: d.show_preview,
      solution_published: d.solution_published,
    }
    const q = d.id
      ? supabase.from('exercises').update(row).eq('id', d.id).select('id').single()
      : supabase.from('exercises').insert(row).select('id').single()
    const { data, error } = await q
    if (error) throw error
    const id = (data as { id: string }).id
    const { error: solErr } = await supabase.from('exercise_solutions').upsert({ exercise_id: id, solution: d.solution, html: d.solution_html, css: d.solution_css })
    if (solErr) throw solErr
    saved.push({ ...d, id })
  }
  return saved
}

export const STATUS_LABEL: Record<SubStatus | 'none', string> = {
  none: 'Pendiente',
  submitted: 'Entregado',
  ok: 'Bien',
  review: 'Repasar',
}

// ---------- Resultado ----------
// La parte bloqueada es siempre la del ejercicio; la editable, la del alumno (o la de la solución).
type Parts = Pick<Exercise, 'html' | 'css' | 'edit_html' | 'edit_css'>

export function compose(ex: Parts, html: string, css: string): { html: string; css: string } {
  return { html: ex.edit_html ? html : ex.html, css: ex.edit_css ? css : ex.css }
}

// Una solución vacía en una parte editable equivale al punto de partida del ejercicio.
export const solutionParts = (ex: Parts, sol: { html: string; css: string }) => compose(ex, sol.html || ex.html, sol.css || ex.css)

// Lo que el alumno tiene en los editores al empezar o tras entregar.
export function startParts(ex: Parts, sub?: Pick<Submission, 'answer_html' | 'answer_css'>) {
  return { html: ex.edit_html && sub ? sub.answer_html : ex.html, css: ex.edit_css && sub ? sub.answer_css : ex.css }
}

export const hasCode = (ex: Parts) => ex.edit_html || ex.edit_css || !!ex.html.trim() || !!ex.css.trim()

// De una solución con explicación ("`h1 { … }`: se hereda") se queda solo con el código.
export function solutionCode(text: string): string {
  const spans = [...text.matchAll(/```[a-z]*\n?([\s\S]*?)```|`([^`]+)`/g)].map((m) => (m[1] ?? m[2]).trim())
  return spans.length ? spans.join('\n') : text
}
