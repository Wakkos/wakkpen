import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Pen, Profile } from '../lib/types'
import type { Sheet } from '../lib/exercises'
import { sessionLink, useSessions, type ClassSession } from '../lib/sessions'
import { timeAgo } from '../lib/export'
import { Page } from '../components/Layout'

// ---------- Profe: lista de sesiones ----------

export function TeacherSessions() {
  const navigate = useNavigate()
  const { sessions, members, loaded, refresh } = useSessions()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('create_session', { p_title: title })
    setBusy(false)
    if (err) return setError(err.message)
    await refresh()
    navigate(`/profesor/sesiones/${(data as ClassSession).id}`)
  }

  const live = sessions.filter((s) => !s.archived)
  const archived = sessions.filter((s) => s.archived)

  return (
    <Page>
      <div className="page-head">
        <h1>Sesiones</h1>
        <form className="inline-form" onSubmit={create}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nueva sesión" maxLength={120} />
          <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} disabled={busy || !title.trim()}>
            Crear
          </button>
        </form>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!loaded ? (
        <div className="skeleton-list" />
      ) : sessions.length === 0 ? (
        <p className="muted">Crea una sesión y comparte su enlace con la clase.</p>
      ) : (
        <>
          <SessionList list={live} members={members} />
          {archived.length > 0 && (
            <details className="archived">
              <summary>Archivadas ({archived.length})</summary>
              <SessionList list={archived} members={members} />
            </details>
          )}
        </>
      )}
    </Page>
  )
}

function SessionList({ list, members }: { list: ClassSession[]; members: Record<string, Set<string>> }) {
  const navigate = useNavigate()
  return (
    <ul className="live-list">
      {list.map((s) => (
        <li key={s.id}>
          <button className="live-row session-row" onClick={() => navigate(`/profesor/sesiones/${s.id}`)}>
            <span className={`pub-dot${s.is_open && !s.archived ? ' is-on' : ''}`} title={s.is_open ? 'Admite gente nueva' : 'Cerrada'} />
            <span className="live-owner">{s.title}</span>
            <span className="session-code">{s.code}</span>
            <span className="live-title">{members[s.id]?.size ?? 0} {(members[s.id]?.size ?? 0) === 1 ? "alumno" : "alumnos"}</span>
            <span className="live-time">{timeAgo(s.created_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---------- Profe: una sesión ----------

interface SheetRow extends Sheet {
  created_by: string | null
}

export function SessionTeacher() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session: auth } = useAuth()
  const { sessions, members, refresh, setActiveId, activeId } = useSessions()
  const s = sessions.find((x) => x.id === id)
  const [title, setTitle] = useState('')
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [people, setPeople] = useState<Record<string, Profile>>({})
  const [teachers, setTeachers] = useState<string[]>([])
  const [sheets, setSheets] = useState<SheetRow[]>([])
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const memberIds = useMemo(() => [...(members[id ?? ''] ?? [])], [members, id])

  useEffect(() => {
    if (s) setTitle(s.title)
  }, [s?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!s) return
    QRCode.toDataURL(sessionLink(s.code), { margin: 1, width: 360, color: { dark: '#0f1115', light: '#ffffff' } }).then(setQr)
  }, [s?.code]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!id) return
    const [{ data: t }, { data: p }, { data: sh }, { data: ss }] = await Promise.all([
      supabase.from('session_teachers').select('user_id').eq('session_id', id),
      supabase.from('profiles').select('*'),
      supabase.from('exercise_sheets').select('*').order('created_at', { ascending: false }),
      supabase.from('session_sheets').select('sheet_id').eq('session_id', id),
    ])
    setTeachers(((t as { user_id: string }[]) ?? []).map((x) => x.user_id))
    setPeople(Object.fromEntries(((p as Profile[]) ?? []).map((x) => [x.id, x])))
    setSheets((sh as SheetRow[]) ?? [])
    setAssigned(new Set(((ss as { sheet_id: string }[]) ?? []).map((x) => x.sheet_id)))
  }

  useEffect(() => {
    load()
  }, [id, memberIds.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!s)
    return (
      <Page>
        <p className="muted">Esta sesión no existe o no eres profe de ella.</p>
        <Link to="/profesor/sesiones">Volver</Link>
      </Page>
    )

  const isOwner = s.owner_id === auth?.user.id

  async function patch(p: Partial<ClassSession>) {
    setError(null)
    const { error: err } = await supabase.from('sessions').update(p).eq('id', s!.id)
    if (err) setError(err.message)
    refresh()
  }

  async function copy() {
    await navigator.clipboard.writeText(sessionLink(s!.code))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function addTeacher(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { error: err } = await supabase.rpc('add_session_teacher', { p_session: s!.id, p_email: email })
    if (err) return setError(err.message)
    setEmail('')
    load()
  }

  async function remove(userId: string) {
    const who = people[userId]?.nombre ?? 'esta persona'
    if (!confirm(`¿Quitar a ${who} de la sesión? Sus pens no se borran.`)) return
    const { error: err } = await supabase.rpc('remove_from_session', { p_session: s!.id, p_user: userId })
    if (err) return setError(err.message)
    refresh()
    load()
  }

  async function toggleSheet(sheetId: string, on: boolean) {
    setError(null)
    setAssigned((a) => {
      const n = new Set(a)
      if (on) n.add(sheetId)
      else n.delete(sheetId)
      return n
    })
    const { error: err } = on
      ? await supabase.from('session_sheets').insert({ session_id: s!.id, sheet_id: sheetId })
      : await supabase.from('session_sheets').delete().eq('session_id', s!.id).eq('sheet_id', sheetId)
    if (err) {
      setError(err.message)
      load()
    }
  }

  async function removeSession() {
    if (!confirm(`¿Borrar la sesión "${s!.title}"? Los alumnos y sus pens no se borran; solo dejan de estar en ella.`)) return
    const { error: err } = await supabase.from('sessions').delete().eq('id', s!.id)
    if (err) return setError(err.message)
    await refresh()
    navigate('/profesor/sesiones')
  }

  // Hojas que puedo asignar: las mías y las ya asignadas a esta sesión.
  const mySheets = sheets.filter((x) => x.created_by === auth?.user.id || assigned.has(x.id))
  const students = memberIds.map((uid) => people[uid]).filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre))

  return (
    <Page>
      <div className="page-head">
        <div>
          <Link to="/profesor/sesiones" className="back-link">
            ‹ Sesiones
          </Link>
          <input
            className="title-input sheet-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== s.title && patch({ title: title.trim() })}
            aria-label="Título de la sesión"
          />
        </div>
        <div className="page-head-actions">
          {activeId !== s.id && !s.archived && (
            <button className="btn btn-ghost btn-sm" onClick={() => setActiveId(s.id)}>
              Hacer activa
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => patch({ archived: !s.archived })}>
            {s.archived ? 'Desarchivar' : 'Archivar'}
          </button>
          {isOwner && (
            <button className="btn btn-sm btn-danger" onClick={removeSession}>
              Borrar
            </button>
          )}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="session-grid">
        <section className="session-share">
          {qr && <img src={qr} alt="" className="session-qr" />}
          <div className="session-share-info">
            <span className="session-code big">{s.code}</span>
            <code className="session-link">{sessionLink(s.code)}</code>
            <button className={`btn btn-primary btn-sm${copied ? ' is-done' : ''}`} onClick={copy}>
              {copied ? 'Copiado ✓' : 'Copiar enlace'}
            </button>
            <label className="check">
              <input type="checkbox" checked={s.is_open} onChange={(e) => patch({ is_open: e.target.checked })} />
              Admite gente nueva
            </label>
            <label className="check">
              <input type="checkbox" checked={s.guests_allowed} onChange={(e) => patch({ guests_allowed: e.target.checked })} />
              Correos de fuera de ESAT
            </label>
          </div>
        </section>

        <section>
          <h2 className="section-title">Profes</h2>
          <ul className="people">
            {teachers.map((t) => (
              <li key={t}>
                <span>{people[t]?.nombre ?? '…'}</span>
                {t === s.owner_id ? <span className="tag tag-muted">Creó la sesión</span> : <RemoveBtn onClick={() => remove(t)} />}
              </li>
            ))}
          </ul>
          <form className="inline-form" onSubmit={addTeacher}>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo de otro profe" />
            <button className="btn btn-ghost btn-sm" disabled={!email.trim()}>
              Añadir
            </button>
          </form>
        </section>

        <section>
          <h2 className="section-title">Hojas de ejercicios</h2>
          {mySheets.length === 0 ? (
            <p className="muted">Aún no tienes hojas.</p>
          ) : (
            <ul className="people">
              {mySheets.map((x) => (
                <li key={x.id}>
                  <label className="check">
                    <input type="checkbox" checked={assigned.has(x.id)} onChange={(e) => toggleSheet(x.id, e.target.checked)} />
                    {x.title}
                  </label>
                  {!x.published && <span className="tag tag-muted">Borrador</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="section-title">
            Alumnos <span className="muted">{students.length}</span>
          </h2>
          {students.length === 0 ? (
            <p className="muted">Comparte el enlace para que se unan.</p>
          ) : (
            <ul className="people">
              {students.map((p) => (
                <li key={p.id}>
                  <span>{p.nombre}</span>
                  <span className="muted small">{p.email}</span>
                  <RemoveBtn onClick={() => remove(p.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Page>
  )
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn people-remove" onClick={onClick} aria-label="Quitar de la sesión" title="Quitar de la sesión">
      ×
    </button>
  )
}

// ---------- Alumno: mis sesiones ----------

export function StudentSessions() {
  const navigate = useNavigate()
  const { sessions, loaded, refresh } = useSessions()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function join(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('join_session', { p_code: code })
    setBusy(false)
    if (err) return setError(err.message)
    await refresh()
    navigate(`/sesion/${data}`)
  }

  return (
    <Page>
      <div className="page-head">
        <h1>Sesiones</h1>
        <form className="inline-form" onSubmit={join}>
          <input
            className="input code-field"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Código"
            maxLength={6}
            aria-label="Código de la sesión"
          />
          <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} disabled={busy || code.trim().length !== 6}>
            Unirme
          </button>
        </form>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!loaded ? (
        <div className="skeleton-list" />
      ) : sessions.length === 0 ? (
        <p className="muted">Aún no estás en ninguna sesión. Escribe el código que te dé tu profe.</p>
      ) : (
        <ul className="pen-grid">
          {sessions.map((s) => (
            <li key={s.id} className="pen-card">
              <button className="pen-card-main" onClick={() => navigate(`/sesion/${s.id}`)}>
                <span className="pen-title">{s.title}</span>
                <span className="pen-meta">{s.archived ? 'Archivada' : s.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

// ---------- Alumno: una sesión ----------

export function SessionStudent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session: auth } = useAuth()
  const { sessions, loaded, refresh } = useSessions()
  const s = sessions.find((x) => x.id === id)
  const [teachers, setTeachers] = useState<string[]>([])
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [pens, setPens] = useState<Pen[]>([])
  const [shared, setShared] = useState<Pen[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!id || !auth) return
    ;(async () => {
      const [{ data: t }, { data: ss }, { data: p }, { data: sh }] = await Promise.all([
        supabase.from('session_teachers').select('profiles(nombre)').eq('session_id', id),
        supabase.from('session_sheets').select('exercise_sheets(*)').eq('session_id', id),
        supabase.from('pens').select('*').eq('owner_id', auth.user.id).eq('session_id', id).order('updated_at', { ascending: false }),
        // Pens que los profes han compartido con la sesión.
        supabase.from('pens').select('*').eq('session_id', id).neq('owner_id', auth.user.id).order('updated_at', { ascending: false }),
      ])
      setTeachers(((t as unknown as { profiles: { nombre: string } | null }[]) ?? []).map((x) => x.profiles?.nombre ?? '').filter(Boolean))
      setSheets(
        ((ss as unknown as { exercise_sheets: Sheet | null }[]) ?? [])
          .map((x) => x.exercise_sheets)
          .filter((x): x is Sheet => !!x && x.published),
      )
      setPens((p as Pen[]) ?? [])
      setShared((sh as Pen[]) ?? [])
    })()
  }, [id, auth])

  if (!loaded) return <div className="app-loading" />
  if (!s)
    return (
      <Page>
        <p className="muted">No estás en esta sesión.</p>
        <Link to="/sesiones">Volver</Link>
      </Page>
    )

  async function newPen() {
    setCreating(true)
    const { data, error } = await supabase.from('pens').insert({ session_id: id }).select('id').single()
    setCreating(false)
    if (!error && data) navigate(`/pen/${data.id}`)
  }

  async function leave() {
    if (!confirm(`¿Salir de "${s!.title}"? Tus pens no se borran.`)) return
    await supabase.rpc('leave_session', { p_session: s!.id })
    await refresh()
    navigate('/sesiones')
  }

  return (
    <Page>
      <div className="page-head">
        <div>
          <Link to="/sesiones" className="back-link">
            ‹ Sesiones
          </Link>
          <h1>{s.title}</h1>
          {teachers.length > 0 && <p className="muted small">Con {teachers.join(', ')}</p>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={leave}>
          Salir
        </button>
      </div>

      <h2 className="section-title">Ejercicios</h2>
      {sheets.length === 0 ? (
        <p className="muted">Aún no hay ejercicios en esta sesión.</p>
      ) : (
        <ul className="pen-grid">
          {sheets.map((x) => (
            <li key={x.id} className="pen-card">
              <button className="pen-card-main" onClick={() => navigate(`/ejercicios/${x.id}`)}>
                <span className="pen-title">{x.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {shared.length > 0 && (
        <>
          <h2 className="section-title section-gap">Del profe</h2>
          <ul className="pen-grid">
            {shared.map((p) => (
              <li key={p.id} className="pen-card">
                <button className="pen-card-main" onClick={() => navigate(`/pen/${p.id}`)}>
                  <span className="pen-title">{p.title}</span>
                  <span className="pen-meta">{timeAgo(p.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="section-head">
        <h2 className="section-title">Mis pens en esta sesión</h2>
        <button className={`btn btn-primary btn-sm${creating ? ' is-busy' : ''}`} onClick={newPen} disabled={creating}>
          Nuevo pen
        </button>
      </div>
      {pens.length === 0 ? (
        <p className="muted">Crea un pen aquí para que tu profe lo vea en la sesión.</p>
      ) : (
        <ul className="pen-grid">
          {pens.map((p) => (
            <li key={p.id} className="pen-card">
              <button className="pen-card-main" onClick={() => navigate(`/pen/${p.id}`)}>
                <span className="pen-title">{p.title}</span>
                <span className="pen-meta">{timeAgo(p.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
