import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile, SaveState } from '../lib/types'
import {
  STATUS_LABEL,
  blankExercise,
  compose,
  hasCode,
  solutionParts,
  parseExercises,
  saveSheet,
  type DraftExercise,
  type Exercise,
  type Sheet,
  type Solution,
  type SubStatus,
  type Submission,
} from '../lib/exercises'
import { Page } from '../components/Layout'
import { StatusDot } from '../components/StatusDot'
import { RichText } from '../components/RichText'
import { CodeEditor } from '../components/CodeEditor'
import { Preview } from '../components/Preview'
import { timeAgo } from '../lib/export'
import { LockIcon } from './SheetStudent'

export function SheetTeacher() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'grade' | 'edit'>(location.search.includes('editar') ? 'edit' : 'grade')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [drafts, setDrafts] = useState<DraftExercise[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [subs, setSubs] = useState<Record<string, Submission>>({}) // clave: exercise_id:user_id
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({}) // clave: submission_id
  const [save, setSave] = useState<SaveState>('idle')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const { data: s } = await supabase.from('exercise_sheets').select('*').eq('id', id).maybeSingle()
    if (!s) return navigate('/profesor/ejercicios')
    setSheet(s as Sheet)
    const { data: ex } = await supabase.from('exercises').select('*').eq('sheet_id', id).order('position')
    const list = (ex as Exercise[]) ?? []
    const ids = list.map((e) => e.id)
    const { data: sols } = ids.length ? await supabase.from('exercise_solutions').select('*').in('exercise_id', ids) : { data: [] }
    const solMap = Object.fromEntries(((sols as Solution[]) ?? []).map((x) => [x.exercise_id, x]))
    setDrafts(
      list.map((e) => ({
        ...e,
        key: e.id,
        solution: solMap[e.id]?.solution ?? '',
        solution_html: solMap[e.id]?.html ?? '',
        solution_css: solMap[e.id]?.css ?? '',
      })),
    )
    if (ids.length) {
      const { data: sb } = await supabase.from('submissions').select('*').in('exercise_id', ids)
      const subList = (sb as Submission[]) ?? []
      setSubs(Object.fromEntries(subList.map((x) => [`${x.exercise_id}:${x.user_id}`, x])))
      if (subList.length) {
        const { data: sg } = await supabase.from('grade_suggestions').select('*').in('submission_id', subList.map((x) => x.id))
        setSuggestions(Object.fromEntries(((sg as Suggestion[]) ?? []).map((x) => [x.submission_id, x])))
      }
    }
  }, [id, navigate])

  useEffect(() => {
    load()
    supabase
      .from('profiles')
      .select('*')
      .eq('role', 'student')
      .order('nombre')
      .then(({ data }) => setStudents((data as Profile[]) ?? []))
  }, [load])

  // Entregas en vivo.
  useEffect(() => {
    const ch = supabase
      .channel(`subs-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, (p) => {
        if (p.eventType === 'DELETE') return
        const row = p.new as Submission
        setSubs((s) => ({ ...s, [`${row.exercise_id}:${row.user_id}`]: row }))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grade_suggestions' }, (p) => {
        if (p.eventType === 'DELETE') {
          const old = p.old as { submission_id?: string }
          if (old.submission_id) setSuggestions((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== old.submission_id)))
          return
        }
        const row = p.new as Suggestion
        setSuggestions((m) => ({ ...m, [row.submission_id]: row }))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [id])

  function patchSheet(p: Partial<Sheet>) {
    setSheet((s) => (s ? { ...s, ...p } : s))
    setDirty(true)
  }
  function patchDraft(key: string, p: Partial<DraftExercise>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)))
    setDirty(true)
  }

  async function persist(nextSheet = sheet, nextDrafts = drafts) {
    if (!nextSheet) return
    setSave('saving')
    setError(null)
    try {
      const saved = await saveSheet(nextSheet, nextDrafts, removed)
      setDrafts(saved.map((d) => ({ ...d, key: d.id! })))
      setRemoved([])
      setDirty(false)
      setSave('saved')
      setTimeout(() => setSave('idle'), 2500)
    } catch (e) {
      setSave('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function togglePublished() {
    if (!sheet) return
    const next = { ...sheet, published: !sheet.published }
    setSheet(next)
    await persist(next)
  }

  async function removeSheet() {
    if (!sheet) return
    const n = Object.keys(subs).length
    const extra = n ? ` Se borran también ${n === 1 ? 'la entrega' : `las ${n} entregas`} de los alumnos.` : ''
    if (!confirm(`¿Borrar la hoja "${sheet.title}"?${extra} No se puede deshacer.`)) return
    const { error } = await supabase.from('exercise_sheets').delete().eq('id', sheet.id)
    if (error) return setError(error.message)
    navigate('/profesor/ejercicios')
  }

  async function toggleSolution(exId: string, value: boolean) {
    const next = drafts.map((d) => (d.id === exId ? { ...d, solution_published: value } : d))
    setDrafts(next)
    await supabase.from('exercises').update({ solution_published: value }).eq('id', exId)
  }

  async function publishAllSolutions(value: boolean) {
    const ids = drafts.filter((d) => d.id).map((d) => d.id!)
    setDrafts((ds) => ds.map((d) => ({ ...d, solution_published: value })))
    if (ids.length) await supabase.from('exercises').update({ solution_published: value }).in('id', ids)
  }

  if (!sheet) return <div className="app-loading" />

  const saved = drafts.filter((d) => d.id)
  const allPublished = saved.length > 0 && saved.every((d) => d.solution_published)

  return (
    <Page>
      <div className="page-head">
        <input className="title-input sheet-title" value={sheet.title} onChange={(e) => patchSheet({ title: e.target.value })} aria-label="Título de la hoja" />
        <div className="page-head-actions">
          <StatusDot state={save} />
          <Link className="btn btn-ghost btn-sm" to={`/ejercicios/${sheet.id}`}>
            Vista alumno
          </Link>
          <button className={`btn btn-sm ${sheet.published ? 'btn-ghost' : 'btn-primary'}`} onClick={togglePublished}>
            {sheet.published ? 'Despublicar' : 'Publicar hoja'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={removeSheet}>
            Borrar
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'grade' ? 'is-on' : ''} onClick={() => setTab('grade')}>
          Corrección
        </button>
        <button className={tab === 'edit' ? 'is-on' : ''} onClick={() => setTab('edit')}>
          Editar{dirty ? ' •' : ''}
        </button>
        {tab === 'grade' && saved.length > 0 && (
          <button className="link-btn tabs-right" onClick={() => publishAllSolutions(!allPublished)}>
            {allPublished ? 'Ocultar todas las soluciones' : 'Publicar todas las soluciones'}
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {tab === 'edit' ? (
        <SheetEdit
          sheet={sheet}
          drafts={drafts}
          onSheet={patchSheet}
          onDraft={patchDraft}
          onDrafts={(d) => {
            setDrafts(d)
            setDirty(true)
          }}
          onRemove={(d) => {
            if (d.id) setRemoved((r) => [...r, d.id!])
            setDrafts((ds) => ds.filter((x) => x.key !== d.key))
            setDirty(true)
          }}
          onSave={() => persist()}
          saving={save === 'saving'}
          dirty={dirty}
        />
      ) : (
        <GradeGrid
          exercises={saved}
          students={students}
          subs={subs}
          suggestions={suggestions}
          onToggleSolution={toggleSolution}
          onGraded={(s) => setSubs((m) => ({ ...m, [`${s.exercise_id}:${s.user_id}`]: s }))}
        />
      )}
    </Page>
  )
}

// ---------- Editar ----------

interface EditProps {
  sheet: Sheet
  drafts: DraftExercise[]
  onSheet: (p: Partial<Sheet>) => void
  onDraft: (key: string, p: Partial<DraftExercise>) => void
  onDrafts: (d: DraftExercise[]) => void
  onRemove: (d: DraftExercise) => void
  onSave: () => void
  saving: boolean
  dirty: boolean
}

function SheetEdit({ sheet, drafts, onSheet, onDraft, onDrafts, onRemove, onSave, saving, dirty }: EditProps) {
  const [importOpen, setImportOpen] = useState(drafts.length === 0)
  const [text, setText] = useState('')
  const preview = useMemo(() => (text.trim() ? parseExercises(text) : null), [text])

  function applyImport() {
    if (!preview) return
    if (drafts.length && !confirm(`Se añadirán ${preview.exercises.length} ejercicios a los ${drafts.length} que ya hay. ¿Seguir?`)) return
    onDrafts([...drafts, ...preview.exercises])
    if (preview.intro && !sheet.intro) onSheet({ intro: preview.intro })
    setText('')
    setImportOpen(false)
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= drafts.length) return
    const next = [...drafts]
    ;[next[i], next[j]] = [next[j], next[i]]
    onDrafts(next)
  }

  return (
    <div className="sheet-edit">
      <div className="sheet-meta">
        <textarea className="input textarea" rows={2} value={sheet.intro} placeholder="Introducción (opcional)" onChange={(e) => onSheet({ intro: e.target.value })} />
      </div>

      <div className={`import${importOpen ? ' is-open' : ''}`}>
        <button className="import-toggle" onClick={() => setImportOpen((o) => !o)}>
          Importar desde texto
        </button>
        {importOpen && (
          <div className="import-body">
            <textarea
              className="input textarea mono"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'1 · Título\nEnunciado…\n`solución`\n\n2 · Título\n…'}
            />
            {preview && (
              <p className="hint left">
                {preview.exercises.length} ejercicios detectados. Revisa enunciados y soluciones antes de publicar.
              </p>
            )}
            {preview?.ignored && (
              <p className="hint left" title={preview.ignored}>
                Se ignora el texto final: «{preview.ignored.slice(0, 80)}{preview.ignored.length > 80 ? '…' : ''}»
              </p>
            )}
            <button className="btn btn-primary btn-sm" disabled={!preview?.exercises.length} onClick={applyImport}>
              Añadir {preview?.exercises.length ? preview.exercises.length : ''} ejercicios
            </button>
          </div>
        )}
      </div>

      <ol className="ex-edit-list">
        {drafts.map((d, i) => (
          <li key={d.key} className="ex-edit">
            <div className="ex-edit-head">
              <span className="ex-num">{i + 1}</span>
              <input className="input" value={d.title} placeholder="Título" onChange={(e) => onDraft(d.key, { title: e.target.value })} />
              <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Subir">
                ↑
              </button>
              <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Bajar">
                ↓
              </button>
              <button className="icon-btn" onClick={() => confirm('¿Borrar este ejercicio y sus entregas?') && onRemove(d)} aria-label="Borrar">
                ×
              </button>
            </div>
            <textarea className="input textarea" rows={3} value={d.prompt} placeholder="Enunciado. Usa `código` para el código." onChange={(e) => onDraft(d.key, { prompt: e.target.value })} />
            <div className="ex-edit-code">
              {(['html', 'css'] as const).map((lang) => {
                const flag = lang === 'html' ? 'edit_html' : 'edit_css'
                return (
                  <div key={lang} className={`edit-pane${d[flag] ? '' : ' is-fixed'}`}>
                    <div className="pane-label">
                      {lang.toUpperCase()}
                      <button
                        className={`lock-toggle${d[flag] ? ' is-open' : ''}`}
                        onClick={() => onDraft(d.key, { [flag]: !d[flag] })}
                        title={d[flag] ? 'El alumno puede editarlo' : 'El alumno solo lo ve'}
                      >
                        {d[flag] ? 'Editable' : <><LockIcon /> Bloqueado</>}
                      </button>
                    </div>
                    <div className="edit-editor">
                      <CodeEditor lang={lang} value={d[lang]} onChange={(v) => onDraft(d.key, { [lang]: v })} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="ex-edit-opts">
              <label className="check">
                <input type="checkbox" checked={d.text_answer} onChange={(e) => onDraft(d.key, { text_answer: e.target.checked })} />
                Respuesta escrita
              </label>
              <label className="check">
                <input type="checkbox" checked={d.show_preview} onChange={(e) => onDraft(d.key, { show_preview: e.target.checked })} />
                Vista previa para el alumno
              </label>
            </div>
            <details className="ex-sol" open={!!(d.solution || d.solution_html || d.solution_css)}>
              <summary>Solución</summary>
              {(d.edit_html || d.edit_css) && (
                <div className="ex-edit-code">
                  {d.edit_html && (
                    <div className="edit-pane">
                      <div className="pane-label">HTML</div>
                      <div className="edit-editor">
                        <CodeEditor lang="html" value={d.solution_html || d.html} onChange={(v) => onDraft(d.key, { solution_html: v })} />
                      </div>
                    </div>
                  )}
                  {d.edit_css && (
                    <div className="edit-pane">
                      <div className="pane-label">CSS</div>
                      <div className="edit-editor">
                        <CodeEditor lang="css" value={d.solution_css || d.css} onChange={(v) => onDraft(d.key, { solution_css: v })} />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <textarea
                className="input textarea solution"
                rows={2}
                value={d.solution}
                placeholder={d.text_answer ? 'Respuesta escrita esperada' : 'Explicación (opcional)'}
                onChange={(e) => onDraft(d.key, { solution: e.target.value })}
              />
            </details>
          </li>
        ))}
      </ol>

      <div className="sheet-edit-foot">
        <button className="btn btn-ghost" onClick={() => onDrafts([...drafts, blankExercise()])}>
          + Ejercicio
        </button>
        <button className={`btn btn-primary${saving ? ' is-busy' : ''}`} onClick={onSave} disabled={saving || !dirty}>
          Guardar
        </button>
      </div>
    </div>
  )
}

// ---------- Corrección ----------

interface Suggestion {
  submission_id: string
  status: 'ok' | 'review'
  comment: string
  created_at: string
}

interface GridProps {
  exercises: DraftExercise[]
  students: Profile[]
  subs: Record<string, Submission>
  suggestions: Record<string, Suggestion>
  onToggleSolution: (exId: string, v: boolean) => void
  onGraded: (s: Submission) => void
}

function GradeGrid({ exercises, students, subs, suggestions, onToggleSolution, onGraded }: GridProps) {
  const [open, setOpen] = useState<{ ex: number; st: number } | null>(null)

  if (!exercises.length) return <p className="muted">Esta hoja aún no tiene ejercicios guardados.</p>

  const cell = (ex: DraftExercise, st: Profile) => subs[`${ex.id}:${st.id}`]
  const counts = exercises.map((ex) => students.filter((s) => cell(ex, s)).length)

  return (
    <>
      <div className="grade-wrap">
        <table className="grade">
          <thead>
            <tr>
              <th />
              {exercises.map((ex, i) => (
                <th key={ex.id} title={ex.title}>
                  <span className="grade-ex">{i + 1}</span>
                  <button
                    className={`sol-toggle${ex.solution_published ? ' is-on' : ''}`}
                    onClick={() => onToggleSolution(ex.id!, !ex.solution_published)}
                    title={ex.solution_published ? 'Solución publicada' : 'Publicar solución'}
                  >
                    {ex.solution_published ? '👁' : '🔒'}
                  </button>
                  <span className="grade-count">
                    {counts[i]}/{students.length}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((st, si) => (
              <tr key={st.id}>
                <th className="grade-name">{st.nombre}</th>
                {exercises.map((ex, ei) => {
                  const s = cell(ex, st)
                  return (
                    <td key={ex.id}>
                      <button
                        key={s?.submitted_at ?? 'none'}
                        className={`grade-cell st-${s?.status ?? 'none'}${s?.graded_by === 'claude' ? ' by-claude' : ''}${s && s.status === 'submitted' && suggestions[s.id] ? ' has-suggestion' : ''}`}
                        onClick={() => s && setOpen({ ex: ei, st: si })}
                        disabled={!s}
                        title={`${st.nombre} · ${ex.title}: ${STATUS_LABEL[s?.status ?? 'none']}`}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <GradeDrawer
          exercise={exercises[open.ex]}
          index={open.ex}
          student={students[open.st]}
          sub={cell(exercises[open.ex], students[open.st])!}
          suggestion={suggestions[cell(exercises[open.ex], students[open.st])!.id]}
          onClose={() => setOpen(null)}
          onGraded={onGraded}
          onNext={() => {
            // siguiente entrega pendiente de corregir en el mismo ejercicio
            for (let k = 1; k <= students.length; k++) {
              const si = (open.st + k) % students.length
              const s = cell(exercises[open.ex], students[si])
              if (s && s.status === 'submitted') return setOpen({ ex: open.ex, st: si })
            }
            setOpen(null)
          }}
        />
      )}
    </>
  )
}

interface DrawerProps {
  exercise: DraftExercise
  index: number
  student: Profile
  sub: Submission
  suggestion?: Suggestion
  onClose: () => void
  onGraded: (s: Submission) => void
  onNext: () => void
}

function GradeDrawer({ exercise, index, student, sub, suggestion, onClose, onGraded, onNext }: DrawerProps) {
  const [comment, setComment] = useState(sub.comment)
  const [busy, setBusy] = useState<SubStatus | null>(null)

  useEffect(() => setComment(sub.comment), [sub.id, sub.comment])

  async function grade(status: SubStatus, text = comment) {
    setBusy(status)
    const { error } = await supabase.rpc('grade_submission', { p_submission: sub.id, p_status: status, p_comment: text })
    setBusy(null)
    if (error) return alert(error.message)
    if (suggestion) await supabase.from('grade_suggestions').delete().eq('submission_id', sub.id)
    onGraded({ ...sub, status, comment: text, graded_at: new Date().toISOString(), graded_by: status === 'submitted' ? null : 'teacher' })
    if (status !== 'submitted') onNext()
  }

  return (
    <div className="drawer drawer-wide" role="dialog" aria-label="Corregir">
      <header className="drawer-header">
        <h2>
          {student.nombre} · {index + 1}. {exercise.title}
          {sub.graded_by === 'claude' && <span className="tag tag-claude">Claude</span>}
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </header>
      <RichText text={exercise.prompt} className="muted-rich" />
      <div className="answer-box">
        {(exercise.edit_html || exercise.edit_css) && (
          <div className="ex-edit-code">
            {exercise.edit_html && (
              <div className="answer-code">
                <CodeEditor lang="html" value={sub.answer_html} readOnly />
              </div>
            )}
            {exercise.edit_css && (
              <div className="answer-code">
                <CodeEditor lang="css" value={sub.answer_css} readOnly />
              </div>
            )}
          </div>
        )}
        {exercise.text_answer && <p className="answer-text">{sub.answer || <em className="muted">Sin texto</em>}</p>}
        <span className="answer-time">{timeAgo(sub.submitted_at)}</span>
      </div>
      {hasCode(exercise) && (
        <div className="compare">
          <figure>
            <figcaption>Su resultado</figcaption>
            <div className="compare-frame">
              <ResultPreview {...compose(exercise, sub.answer_html, sub.answer_css)} />
            </div>
          </figure>
          <figure>
            <figcaption>Solución</figcaption>
            <div className="compare-frame">
              <ResultPreview {...solutionParts(exercise, { html: exercise.solution_html, css: exercise.solution_css })} />
            </div>
          </figure>
        </div>
      )}
      {exercise.solution && (
        <details className="solution-peek" open={exercise.text_answer}>
          <summary>{exercise.text_answer ? 'Respuesta esperada' : 'Explicación'}</summary>
          <RichText text={exercise.solution} />
        </details>
      )}
      {suggestion && sub.status === 'submitted' && (
        <div className={`suggestion st-${suggestion.status}`}>
          <span className="suggestion-label">Claude sugiere: {suggestion.status === 'ok' ? '✓ Bien' : 'Repasar'}</span>
          {suggestion.comment && <p>{suggestion.comment}</p>}
          <div className="suggestion-actions">
            <button className="btn btn-sm btn-primary" onClick={() => grade(suggestion.status, suggestion.comment)} disabled={!!busy}>
              Aplicar
            </button>
            <button className="link-btn" onClick={() => setComment(suggestion.comment)}>
              Usar el comentario
            </button>
          </div>
        </div>
      )}
      <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comentario (opcional)" />
      <div className="grade-actions">
        <button className={`btn btn-ok${sub.status === 'ok' ? ' is-current' : ''}${busy === 'ok' ? ' is-busy' : ''}`} onClick={() => grade('ok')} disabled={!!busy}>
          ✓ Bien
        </button>
        <button className={`btn btn-review${sub.status === 'review' ? ' is-current' : ''}${busy === 'review' ? ' is-busy' : ''}`} onClick={() => grade('review')} disabled={!!busy}>
          Repasar
        </button>
        {sub.status !== 'submitted' && (
          <button className="link-btn" onClick={() => grade('submitted')} disabled={!!busy}>
            Quitar corrección
          </button>
        )}
      </div>
    </div>
  )
}

export function ResultPreview({ html, css }: { html: string; css: string }) {
  return <Preview html={html} css={css} cssLang="css" js="" bare delay={150} />
}
