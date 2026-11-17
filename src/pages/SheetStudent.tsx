import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { SaveState } from '../lib/types'
import { STATUS_LABEL, compose, hasCode, startParts, type Exercise, type Sheet, type Solution, type Submission } from '../lib/exercises'
import { Page } from '../components/Layout'
import { RichText } from '../components/RichText'
import { CodeEditor } from '../components/CodeEditor'
import { Preview } from '../components/Preview'
import { StatusDot } from '../components/StatusDot'
import { HandButton } from '../components/HandButton'

interface Draft {
  html: string
  css: string
  text: string
}

const startDraft = (ex: Exercise, sub?: Submission): Draft => ({ ...startParts(ex, sub), text: sub?.answer ?? '' })

// Hay algo que entregar: difiere de lo último entregado (o del punto de partida si no hay entrega).
function isDirty(ex: Exercise, d: Draft | undefined, sub?: Submission) {
  if (!d) return false
  const base = startDraft(ex, sub)
  return (ex.edit_html && d.html !== base.html) || (ex.edit_css && d.css !== base.css) || (ex.text_answer && d.text !== base.text)
}

export function SheetStudent() {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const { session, profile } = useAuth()
  const preview = profile?.role === 'teacher'
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [missing, setMissing] = useState(false)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [solutions, setSolutions] = useState<Record<string, Solution>>({})
  const [subs, setSubs] = useState<Record<string, Submission>>({})
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const uid = session?.user.id

  const idx = Math.min(Math.max(Number(params.get('n') ?? 1) - 1, 0), Math.max(exercises.length - 1, 0))
  const go = (i: number) => setParams({ n: String(i + 1) }, { replace: true })

  async function loadSolutions(ids: string[]) {
    if (!ids.length) return
    const { data } = await supabase.from('exercise_solutions').select('*').in('exercise_id', ids)
    setSolutions((m) => ({ ...m, ...Object.fromEntries(((data as Solution[]) ?? []).map((x) => [x.exercise_id, x])) }))
  }

  useEffect(() => {
    if (!id || !uid) return
    ;(async () => {
      const { data: s } = await supabase.from('exercise_sheets').select('*').eq('id', id).maybeSingle()
      if (!s) return setMissing(true)
      setSheet(s as Sheet)
      const { data: ex } = await supabase.from('exercises').select('*').eq('sheet_id', id).order('position')
      const list = (ex as Exercise[]) ?? []
      setExercises(list)
      const ids = list.map((e) => e.id)
      loadSolutions(ids)
      if (ids.length) {
        const { data: sb } = await supabase.from('submissions').select('*').eq('user_id', uid).in('exercise_id', ids)
        setSubs(Object.fromEntries(((sb as Submission[]) ?? []).map((x) => [x.exercise_id, x])))
      }
    })()
  }, [id, uid])

  // Correcciones y soluciones publicadas llegan en vivo.
  useEffect(() => {
    if (!id || !uid) return
    const ch = supabase
      .channel(`sheet-${id}-${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `user_id=eq.${uid}` }, (p) => {
        const row = p.new as Submission
        setSubs((s) => ({ ...s, [row.exercise_id]: row }))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'exercises', filter: `sheet_id=eq.${id}` }, (p) => {
        const row = p.new as Exercise
        setExercises((ex) => ex.map((e) => (e.id === row.id ? row : e)))
        if (row.solution_published) loadSolutions([row.id])
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [id, uid])

  const unsent = useMemo(() => exercises.filter((e) => isDirty(e, drafts[e.id], subs[e.id])), [exercises, drafts, subs])

  // Avisar antes de cerrar la pestaña con cambios sin entregar.
  useEffect(() => {
    if (!unsent.length || preview) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsent.length, preview])

  if (missing)
    return (
      <Page>
        <p>Esta hoja no existe o aún no está publicada.</p>
        <Link to="/ejercicios">Volver</Link>
      </Page>
    )
  if (!sheet) return <div className="app-loading" />

  const ex = exercises[idx]
  const unsentIds = new Set(unsent.map((e) => e.id))

  return (
    <Page wide>
      <div className="slide-top">
        <Link to={preview ? `/profesor/ejercicios/${sheet.id}` : '/ejercicios'} className="back-link">
          ‹ {preview ? 'Volver a corregir' : 'Ejercicios'}
        </Link>
        <h1 className="slide-sheet">{sheet.title}</h1>
        <nav className="ex-dots" aria-label="Ejercicios">
          {exercises.map((e, i) => {
            const st = unsentIds.has(e.id) ? 'draft' : (subs[e.id]?.status ?? 'none')
            return (
              <button
                key={e.id}
                className={`ex-dot st-${st}${i === idx ? ' is-current' : ''}`}
                onClick={() => go(i)}
                title={`${i + 1}. ${e.title} · ${st === 'draft' ? 'Sin entregar' : STATUS_LABEL[st]}`}
                aria-current={i === idx ? 'step' : undefined}
              >
                {i + 1}
              </button>
            )
          })}
        </nav>
        <HandButton />
      </div>
      {preview && (
        <p className="preview-banner">
          Vista de alumno{sheet.published ? '' : ' · borrador'}. Puedes escribir para probar, pero no se entrega nada.
        </p>
      )}
      {idx === 0 && sheet.intro && <RichText text={sheet.intro} className="sheet-intro" />}
      {ex ? (
        <Slide
          key={ex.id}
          n={idx + 1}
          total={exercises.length}
          exercise={ex}
          solution={ex.solution_published ? solutions[ex.id] : undefined}
          sub={subs[ex.id]}
          draft={drafts[ex.id] ?? startDraft(ex, subs[ex.id])}
          dirty={unsentIds.has(ex.id)}
          preview={preview}
          onDraft={(d) => setDrafts((m) => ({ ...m, [ex.id]: d }))}
          onSaved={(s) => {
            setSubs((m) => ({ ...m, [s.exercise_id]: s }))
            setDrafts((m) => ({ ...m, [s.exercise_id]: startDraft(ex, s) }))
          }}
          onPrev={idx > 0 ? () => go(idx - 1) : undefined}
          onNext={idx < exercises.length - 1 ? () => go(idx + 1) : undefined}
        />
      ) : (
        <p className="muted">Esta hoja todavía no tiene ejercicios.</p>
      )}
    </Page>
  )
}

interface SlideProps {
  n: number
  total: number
  exercise: Exercise
  solution?: Solution
  sub?: Submission
  draft: Draft
  dirty: boolean
  preview?: boolean
  onDraft: (d: Draft) => void
  onSaved: (s: Submission) => void
  onPrev?: () => void
  onNext?: () => void
}

function Slide({ n, total, exercise: ex, solution, sub, draft, dirty, preview, onDraft, onSaved, onPrev, onNext }: SlideProps) {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const graded = !!sub && sub.status !== 'submitted'
  const locked = graded || ex.solution_published
  const answerable = ex.edit_html || ex.edit_css || ex.text_answer
  const status = sub?.status ?? 'none'
  const showHtml = ex.edit_html || !!ex.html.trim()
  const showCss = ex.edit_css || !!ex.css.trim()
  const showPreview = hasCode(ex) && (ex.show_preview || graded)
  // Con la vista previa a la vista se ve lo que hay en los editores; si no, lo entregado.
  const result = ex.show_preview ? compose(ex, draft.html, draft.css) : compose(ex, sub?.answer_html ?? '', sub?.answer_css ?? '')

  async function submit() {
    setState('saving')
    setError(null)
    const row = {
      answer: ex.text_answer ? draft.text : '',
      answer_html: ex.edit_html ? draft.html : '',
      answer_css: ex.edit_css ? draft.css : '',
    }
    const res = sub
      ? await supabase
          .from('submissions')
          .update({ ...row, submitted_at: new Date().toISOString() })
          .eq('id', sub.id)
          .select('*')
          .single()
      : await supabase
          .from('submissions')
          .insert({ exercise_id: ex.id, ...row })
          .select('*')
          .single()
    if (res.error) {
      setState('error')
      setError(res.error.message)
      return
    }
    onSaved(res.data as Submission)
    setState('saved')
    setTimeout(() => setState('idle'), 2000)
  }

  const pane = (lang: 'html' | 'css') => {
    const editable = (lang === 'html' ? ex.edit_html : ex.edit_css) && !locked
    const fixed = lang === 'html' ? !ex.edit_html : !ex.edit_css
    return (
      <div className={`slide-pane${fixed ? ' is-fixed' : ''}`}>
        <div className="pane-label">
          {lang.toUpperCase()}
          {fixed && <LockIcon />}
        </div>
        <div className="slide-editor">
          <CodeEditor lang={lang} value={draft[lang]} readOnly={!editable} onChange={(v) => onDraft({ ...draft, [lang]: v })} />
        </div>
      </div>
    )
  }

  return (
    <section className={`slide st-${status}`}>
      <header className="slide-head">
        <span className="ex-num">{n}</span>
        <h2>{ex.title}</h2>
        <span className={`status-chip st-${dirty ? 'draft' : status}`}>{dirty ? 'Sin entregar' : STATUS_LABEL[status]}</span>
      </header>
      <RichText text={ex.prompt} className="slide-prompt" />

      {hasCode(ex) && (
        <div className={`slide-work${showPreview ? ' has-preview' : ''}${showHtml && showCss ? ' two' : ''}`}>
          <div className="slide-code">
            {showHtml && pane('html')}
            {showCss && pane('css')}
          </div>
          {showPreview && (
            <div className="slide-pane slide-result">
              <div className="pane-label">Resultado</div>
              <div className="slide-editor">
                <Preview html={result.html} css={result.css} cssLang="css" js="" bare delay={400} />
              </div>
            </div>
          )}
        </div>
      )}

      {ex.text_answer && (
        <textarea
          className="input textarea slide-text"
          rows={3}
          value={draft.text}
          readOnly={locked}
          onChange={(e) => onDraft({ ...draft, text: e.target.value })}
          placeholder="Tu respuesta"
        />
      )}

      {sub?.comment && graded && <p className="teacher-comment">{sub.comment}</p>}
      {solution && <SolutionView exercise={ex} solution={solution} />}
      {error && <p className="form-error">{error}</p>}

      <footer className="slide-nav">
        <button className="btn btn-ghost" onClick={onPrev} disabled={!onPrev}>
          ‹ Anterior
        </button>
        <span className="slide-count">
          {n} / {total}
        </span>
        {answerable && !locked && (
          <span className="slide-submit">
            <StatusDot state={state} />
            <button
              className={`btn btn-primary${state === 'saving' ? ' is-busy' : ''}`}
              onClick={submit}
              disabled={preview || state === 'saving' || !dirty}
            >
              {sub ? 'Actualizar' : 'Entregar'}
            </button>
          </span>
        )}
        <button className={`btn ${!dirty && sub && onNext ? 'btn-primary' : 'btn-ghost'}`} onClick={onNext} disabled={!onNext}>
          Siguiente ›
        </button>
      </footer>
    </section>
  )
}

function SolutionView({ exercise: ex, solution }: { exercise: Exercise; solution: Solution }) {
  const html = ex.edit_html && solution.html.trim()
  const css = ex.edit_css && solution.css.trim()
  if (!html && !css && !solution.solution.trim()) return null
  return (
    <div className="solution">
      <span className="solution-label">Solución</span>
      {(html || css) && (
        <div className="solution-code">
          {html && (
            <div className="base-code">
              <CodeEditor lang="html" value={solution.html} readOnly />
            </div>
          )}
          {css && (
            <div className="base-code">
              <CodeEditor lang="css" value={solution.css} readOnly />
            </div>
          )}
        </div>
      )}
      {solution.solution.trim() && <RichText text={solution.solution} />}
    </div>
  )
}

export function LockIcon() {
  return (
    <svg className="lock-icon" width="11" height="11" viewBox="0 0 16 16" aria-label="Solo lectura">
      <path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm2 0h4V5a2 2 0 1 0-4 0v2Z" />
    </svg>
  )
}
