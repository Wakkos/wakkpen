import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Pen, SaveState } from '../lib/types'
import { STATUS_LABEL, type Exercise, type PenSnapshot, type Sheet, type Submission } from '../lib/exercises'
import { Page } from '../components/Layout'
import { RichText } from '../components/RichText'
import { CodeEditor } from '../components/CodeEditor'
import { StatusDot } from '../components/StatusDot'
import { HandButton } from '../components/HandButton'

type PenLite = Pick<Pen, 'id' | 'title'>

export function SheetStudent() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [missing, setMissing] = useState(false)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [solutions, setSolutions] = useState<Record<string, string>>({})
  const [subs, setSubs] = useState<Record<string, Submission>>({})
  const [pens, setPens] = useState<PenLite[]>([])
  const uid = session?.user.id

  async function loadSolutions(ids: string[]) {
    if (!ids.length) return
    const { data } = await supabase.from('exercise_solutions').select('*').in('exercise_id', ids)
    setSolutions(Object.fromEntries(((data as { exercise_id: string; solution: string }[]) ?? []).map((x) => [x.exercise_id, x.solution])))
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
    supabase
      .from('pens')
      .select('id, title')
      .eq('owner_id', uid)
      .order('updated_at', { ascending: false })
      .then(({ data }) => setPens((data as PenLite[]) ?? []))
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
        if (row.solution_published) loadSolutions([row.id]).then(() => undefined)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [id, uid])

  if (missing)
    return (
      <Page>
        <p>Esta hoja no existe o aún no está publicada.</p>
        <Link to="/ejercicios">Volver</Link>
      </Page>
    )
  if (!sheet) return <div className="app-loading" />

  const done = exercises.filter((e) => subs[e.id]).length

  return (
    <Page>
      <div className="page-head">
        <div>
          <Link to="/ejercicios" className="back-link">
            ‹ Ejercicios
          </Link>
          <h1>{sheet.title}</h1>
        </div>
        <div className="page-head-actions">
          <span className="muted">
            {done}/{exercises.length}
          </span>
          <HandButton />
        </div>
      </div>
      {sheet.intro && <RichText text={sheet.intro} className="sheet-intro" />}
      <ol className="ex-list">
        {exercises.map((ex, i) => (
          <ExerciseCard
            key={ex.id}
            n={i + 1}
            exercise={ex}
            solution={ex.solution_published ? solutions[ex.id] : undefined}
            sub={subs[ex.id]}
            pens={pens}
            onSaved={(s) => setSubs((m) => ({ ...m, [s.exercise_id]: s }))}
          />
        ))}
      </ol>
    </Page>
  )
}

interface CardProps {
  n: number
  exercise: Exercise
  solution?: string
  sub?: Submission
  pens: PenLite[]
  onSaved: (s: Submission) => void
}

function ExerciseCard({ n, exercise, solution, sub, pens, onSaved }: CardProps) {
  const [answer, setAnswer] = useState(sub?.answer ?? '')
  const [penId, setPenId] = useState(sub?.pen_snapshot?.pen_id ?? '')
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const locked = (!!sub && sub.status !== 'submitted') || exercise.solution_published
  const changed = !sub || answer !== sub.answer || penId !== (sub.pen_snapshot?.pen_id ?? '')
  const status = sub?.status ?? 'none'

  useEffect(() => {
    if (sub) {
      setAnswer(sub.answer)
      setPenId(sub.pen_snapshot?.pen_id ?? '')
    }
  }, [sub?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setState('saving')
    setError(null)
    let snapshot: PenSnapshot | null = null
    if (penId) {
      const { data } = await supabase.from('pens').select('id, title, html, css, css_lang, js, libs').eq('id', penId).maybeSingle()
      if (data) {
        const p = data as Pen
        snapshot = { pen_id: p.id, title: p.title, html: p.html, css: p.css, css_lang: p.css_lang, js: p.js, libs: p.libs ?? [] }
      }
    }
    const res = sub
      ? await supabase
          .from('submissions')
          .update({ answer, pen_snapshot: snapshot, submitted_at: new Date().toISOString() })
          .eq('id', sub.id)
          .select('*')
          .single()
      : await supabase.from('submissions').insert({ exercise_id: exercise.id, answer, pen_snapshot: snapshot }).select('*').single()
    if (res.error) {
      setState('error')
      setError(res.error.message)
      return
    }
    onSaved(res.data as Submission)
    setState('saved')
    setTimeout(() => setState('idle'), 2000)
  }

  return (
    <li className={`ex-card st-${status}`}>
      <header className="ex-card-head">
        <span className="ex-num">{n}</span>
        <h2>{exercise.title}</h2>
        <span className={`status-chip st-${status}`}>{STATUS_LABEL[status]}</span>
      </header>
      <RichText text={exercise.prompt} />

      {exercise.answer_kind === 'code' ? (
        <div className={`answer-code${locked ? ' is-locked' : ''}`}>
          <CodeEditor lang={exercise.lang} value={answer} readOnly={locked} onChange={setAnswer} />
        </div>
      ) : (
        <textarea className="input textarea" rows={3} value={answer} readOnly={locked} onChange={(e) => setAnswer(e.target.value)} placeholder="Tu respuesta" />
      )}

      <div className="ex-card-foot">
        {exercise.allow_pen && (
          <select className="select select-sm" value={penId} onChange={(e) => setPenId(e.target.value)} disabled={locked} aria-label="Adjuntar pen">
            <option value="">Sin pen</option>
            {pens.map((p) => (
              <option key={p.id} value={p.id}>
                📎 {p.title}
              </option>
            ))}
          </select>
        )}
        {!locked && (
          <>
            <StatusDot state={state} />
            <button className={`btn btn-primary btn-sm${state === 'saving' ? ' is-busy' : ''}`} onClick={submit} disabled={state === 'saving' || (!changed && !!sub) || (!answer.trim() && !penId)}>
              {sub ? 'Actualizar' : 'Entregar'}
            </button>
          </>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}

      {sub?.comment && sub.status !== 'submitted' && <p className="teacher-comment">{sub.comment}</p>}
      {solution !== undefined && solution !== '' && (
        <div className="solution">
          <span className="solution-label">Solución</span>
          <RichText text={solution} />
        </div>
      )}
    </li>
  )
}
