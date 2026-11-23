import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { compose, hasCode, solutionParts, type Exercise, type Sheet, type Solution, type SubStatus } from '../lib/exercises'
import { useSessions } from '../lib/sessions'
import { RichText } from '../components/RichText'
import { CodeEditor } from '../components/CodeEditor'
import { Preview } from '../components/Preview'
import { LockIcon } from './SheetStudent'

interface SubLite {
  exercise_id: string
  user_id: string
  status: SubStatus
}

// Corregir en clase: un ejercicio por pantalla, para proyectar. Primero el punto de partida;
// con "Ver solución", la solución y su resultado. El código se puede tocar para explicar, sin guardar nada.
export function ClassMode() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { members } = useSessions()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [solutions, setSolutions] = useState<Record<string, Solution>>({})
  const [subs, setSubs] = useState<SubLite[]>([])
  const [sessionIds, setSessionIds] = useState<string[]>([])

  const idx = Math.min(Math.max(Number(params.get('n') ?? 1) - 1, 0), Math.max(exercises.length - 1, 0))
  const go = useCallback((i: number) => setParams({ n: String(i + 1) }, { replace: true }), [setParams])
  const exit = useCallback(() => navigate(`/profesor/ejercicios/${id}`), [navigate, id])

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const { data: s } = await supabase.from('exercise_sheets').select('*').eq('id', id).maybeSingle()
      if (!s) return navigate('/profesor/ejercicios')
      setSheet(s as Sheet)
      const { data: ex } = await supabase.from('exercises').select('*').eq('sheet_id', id).order('position')
      const list = (ex as Exercise[]) ?? []
      setExercises(list)
      const ids = list.map((e) => e.id)
      if (!ids.length) return
      const [{ data: sol }, { data: sb }, { data: ss }] = await Promise.all([
        supabase.from('exercise_solutions').select('*').in('exercise_id', ids),
        supabase.from('submissions').select('exercise_id, user_id, status').in('exercise_id', ids),
        supabase.from('session_sheets').select('session_id').eq('sheet_id', id),
      ])
      setSolutions(Object.fromEntries(((sol as Solution[]) ?? []).map((x) => [x.exercise_id, x])))
      setSubs((sb as SubLite[]) ?? [])
      setSessionIds(((ss as { session_id: string }[]) ?? []).map((x) => x.session_id))
    })()
  }, [id, navigate])

  // Entregas y correcciones en vivo, para el recuento.
  useEffect(() => {
    if (!id) return
    const ch = supabase
      .channel(`clase-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, (p) => {
        if (p.eventType === 'DELETE') return
        const row = p.new as SubLite
        setSubs((list) => [...list.filter((x) => !(x.exercise_id === row.exercise_id && x.user_id === row.user_id)), row])
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Dentro del editor, las flechas mueven el cursor.
      if ((e.target as HTMLElement)?.closest?.('.cm-editor, input, textarea')) return
      if (e.key === 'ArrowRight' && idx < exercises.length - 1) go(idx + 1)
      if (e.key === 'ArrowLeft' && idx > 0) go(idx - 1)
      if (e.key === 'Escape') exit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, exercises.length, go, exit])

  // Alumnos que deberían hacerla: los de las sesiones de la hoja.
  const expected = useMemo(() => {
    const set = new Set<string>()
    for (const sid of sessionIds) for (const u of members[sid] ?? []) set.add(u)
    return set
  }, [sessionIds, members])

  if (!sheet) return <div className="app-loading" />
  const ex = exercises[idx]

  async function publish(exercise: Exercise, value: boolean) {
    setExercises((list) => list.map((e) => (e.id === exercise.id ? { ...e, solution_published: value } : e)))
    const { error } = await supabase.from('exercises').update({ solution_published: value }).eq('id', exercise.id)
    if (error) setExercises((list) => list.map((e) => (e.id === exercise.id ? { ...e, solution_published: !value } : e)))
  }

  return (
    <div className="cls">
      <header className="cls-top">
        <span className="cls-sheet">{sheet.title}</span>
        <nav className="ex-dots" aria-label="Ejercicios">
          {exercises.map((e, i) => (
            <button key={e.id} className={`ex-dot${i === idx ? ' is-current' : ''}${e.solution_published ? ' st-ok' : ''}`} onClick={() => go(i)} title={e.title}>
              {i + 1}
            </button>
          ))}
        </nav>
        <button className="icon-btn cls-exit" onClick={exit} aria-label="Salir (Esc)" title="Salir (Esc)">
          ×
        </button>
      </header>
      {ex ? (
        <ClassSlide
          key={ex.id}
          exercise={ex}
          solution={solutions[ex.id]}
          counts={count(subs.filter((s) => s.exercise_id === ex.id), expected)}
          onPublish={(v) => publish(ex, v)}
          onPrev={idx > 0 ? () => go(idx - 1) : undefined}
          onNext={idx < exercises.length - 1 ? () => go(idx + 1) : undefined}
          n={idx + 1}
          total={exercises.length}
        />
      ) : (
        <p className="muted cls-empty">Esta hoja no tiene ejercicios.</p>
      )}
    </div>
  )
}

function count(list: SubLite[], expected: Set<string>) {
  const ok = list.filter((s) => s.status === 'ok').length
  const review = list.filter((s) => s.status === 'review').length
  const pending = list.filter((s) => s.status === 'submitted').length
  const done = new Set(list.map((s) => s.user_id))
  const missing = [...expected].filter((u) => !done.has(u)).length
  return { ok, review, pending, missing }
}

interface SlideProps {
  exercise: Exercise
  solution?: Solution
  counts: ReturnType<typeof count>
  onPublish: (v: boolean) => void
  onPrev?: () => void
  onNext?: () => void
  n: number
  total: number
}

function ClassSlide({ exercise: ex, solution, counts, onPublish, onPrev, onNext, n, total }: SlideProps) {
  const [revealed, setRevealed] = useState(false)
  const start = { html: ex.html, css: ex.css }
  const sol = solution ? solutionParts(ex, solution) : start
  // Copia de trabajo para explicar en directo; no se guarda.
  const [code, setCode] = useState(start)
  useEffect(() => setCode(revealed ? sol : start), [revealed]) // eslint-disable-line react-hooks/exhaustive-deps

  const result = compose({ ...ex, edit_html: true, edit_css: true }, code.html, code.css)
  const showHtml = ex.edit_html || !!ex.html.trim() || !!solution?.html.trim()
  const showCss = ex.edit_css || !!ex.css.trim() || !!solution?.css.trim()
  const changed = code.html !== (revealed ? sol : start).html || code.css !== (revealed ? sol : start).css

  return (
    <section className="cls-slide">
      <div className="cls-head">
        <span className="ex-num">{n}</span>
        <h1>{ex.title}</h1>
        <span className="cls-counts" title="Bien · Para repasar · Sin corregir · Sin entregar">
          <span className="c-ok">✓ {counts.ok}</span>
          <span className="c-review">↻ {counts.review}</span>
          <span className="c-pending">● {counts.pending}</span>
          {counts.missing > 0 && <span className="c-missing">○ {counts.missing}</span>}
        </span>
      </div>
      <RichText text={ex.prompt} className="cls-prompt" />

      {hasCode(ex) && (
        <div className="cls-work">
          <div className="cls-code">
            {(['html', 'css'] as const)
              .filter((l) => (l === 'html' ? showHtml : showCss))
              .map((lang) => (
                <div key={lang} className={`slide-pane${(lang === 'html' ? ex.edit_html : ex.edit_css) ? '' : ' is-fixed'}`}>
                  <div className="pane-label">
                    {lang.toUpperCase()}
                    {!(lang === 'html' ? ex.edit_html : ex.edit_css) && <LockIcon />}
                    {revealed && (lang === 'html' ? ex.edit_html : ex.edit_css) && <span className="tag cls-sol-tag">Solución</span>}
                  </div>
                  <div className="slide-editor cls-big">
                    <CodeEditor key={`${lang}-${revealed}`} lang={lang} value={code[lang]} onChange={(v) => setCode((c) => ({ ...c, [lang]: v }))} />
                  </div>
                </div>
              ))}
          </div>
          <div className="slide-pane slide-result">
            <div className="pane-label">Resultado</div>
            <div className="slide-editor">
              <Preview html={result.html} css={result.css} cssLang="css" js="" bare delay={250} />
            </div>
          </div>
        </div>
      )}

      {revealed && solution?.solution.trim() && (
        <div className="solution cls-note">
          <span className="solution-label">{ex.text_answer ? 'Respuesta' : 'Explicación'}</span>
          <RichText text={solution.solution} />
        </div>
      )}

      <footer className="cls-nav">
        <button className="btn btn-ghost" onClick={onPrev} disabled={!onPrev}>
          ‹ Anterior
        </button>
        <span className="slide-count">
          {n} / {total}
        </span>
        {changed && (
          <button className="link-btn" onClick={() => setCode(revealed ? sol : start)}>
            Deshacer cambios
          </button>
        )}
        <button className={`btn ${revealed ? 'btn-ghost' : 'btn-primary'}`} onClick={() => setRevealed((r) => !r)}>
          {revealed ? 'Ocultar solución' : 'Ver solución'}
        </button>
        <label className="check cls-publish" title="Los alumnos la verán en la pestaña Solución de este ejercicio y ya no podrán cambiar su entrega">
          <input type="checkbox" checked={ex.solution_published} onChange={(e) => onPublish(e.target.checked)} />
          Publicada a los alumnos
        </label>
        <button className="btn btn-ghost" onClick={onNext} disabled={!onNext}>
          Siguiente ›
        </button>
      </footer>
    </section>
  )
}
