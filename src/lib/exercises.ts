import { supabase } from './supabase'
import type { CssLang } from './types'

export type ExLang = 'html' | 'css' | 'js'
export type AnswerKind = 'code' | 'text'
export type SubStatus = 'submitted' | 'ok' | 'review'

export interface Sheet {
  id: string
  title: string
  intro: string
  lang: ExLang
  published: boolean
  created_at: string
  updated_at: string
}

export interface Exercise {
  id: string
  sheet_id: string
  position: number
  title: string
  prompt: string
  answer_kind: AnswerKind
  lang: ExLang
  allow_pen: boolean
  solution_published: boolean
  base_html: string
  base_css: string
  show_preview: boolean
}

export interface PenSnapshot {
  pen_id: string
  title: string
  html: string
  css: string
  css_lang: CssLang
  js: string
  libs: string[]
}

export interface Submission {
  id: string
  exercise_id: string
  user_id: string
  answer: string
  pen_snapshot: PenSnapshot | null
  status: SubStatus
  comment: string
  submitted_at: string
  graded_at: string | null
  graded_by: 'teacher' | 'claude' | null
}

// Borrador de ejercicio en el editor del profe (antes de guardar).
export interface DraftExercise {
  id?: string
  key: string
  title: string
  prompt: string
  answer_kind: AnswerKind
  lang: ExLang
  allow_pen: boolean
  solution: string
  solution_published: boolean
  base_html: string
  base_css: string
  show_preview: boolean
}

let seq = 0
export const newKey = () => `k${Date.now().toString(36)}${seq++}`

export function blankExercise(lang: ExLang): DraftExercise {
  return { key: newKey(), title: '', prompt: '', answer_kind: 'code', lang, allow_pen: false, solution: '', solution_published: false, base_html: '', base_css: '', show_preview: false }
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

export function parseExercises(text: string, lang: ExLang): { intro: string; exercises: DraftExercise[]; ignored: string } {
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
    return {
      ...blankExercise(lang),
      title,
      prompt,
      solution,
      answer_kind: (isText ? 'text' : 'code') as AnswerKind,
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
    .map((p) => `<p>${escapeHtml(p).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
    .join('')
}

// ---------- Guardado del profe ----------
export async function saveSheet(sheet: Sheet, drafts: DraftExercise[], removed: string[]): Promise<DraftExercise[]> {
  const { error: sErr } = await supabase
    .from('exercise_sheets')
    .update({ title: sheet.title, intro: sheet.intro, lang: sheet.lang, published: sheet.published })
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
      answer_kind: d.answer_kind,
      lang: d.lang,
      allow_pen: d.allow_pen,
      solution_published: d.solution_published,
      base_html: d.base_html,
      base_css: d.base_css,
      show_preview: d.show_preview,
    }
    const q = d.id
      ? supabase.from('exercises').update(row).eq('id', d.id).select('id').single()
      : supabase.from('exercises').insert(row).select('id').single()
    const { data, error } = await q
    if (error) throw error
    const id = (data as { id: string }).id
    const { error: solErr } = await supabase.from('exercise_solutions').upsert({ exercise_id: id, solution: d.solution })
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

// ---------- Resultado: base del ejercicio + lo que escribe el alumno ----------
type WithBase = Pick<Exercise, 'lang' | 'base_html' | 'base_css'>

export function composeResult(ex: WithBase, code: string): { html: string; css: string; js: string } {
  if (ex.lang === 'html') return { html: code, css: ex.base_css, js: '' }
  if (ex.lang === 'js') return { html: ex.base_html, css: ex.base_css, js: code }
  return { html: ex.base_html, css: `${ex.base_css}\n${code}`, js: '' }
}

// De una solución con explicación ("`h1 { … }`: se hereda") se queda solo con el código.
export function solutionCode(text: string): string {
  const spans = [...text.matchAll(/```[a-z]*\n?([\s\S]*?)```|`([^`]+)`/g)].map((m) => (m[1] ?? m[2]).trim())
  return spans.length ? spans.join('\n') : text
}

export const hasBase = (ex: WithBase) => !!(ex.base_html.trim() || ex.base_css.trim())
