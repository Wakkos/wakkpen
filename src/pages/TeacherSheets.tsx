import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Sheet } from '../lib/exercises'
import { timeAgo } from '../lib/export'
import { Page } from '../components/Layout'
import { useAuth } from '../lib/auth'
import { useSessions } from '../lib/sessions'

export function TeacherSheets() {
  const navigate = useNavigate()
  const [sheets, setSheets] = useState<(Sheet & { created_by: string | null; exercises: { count: number }[] })[] | null>(null)
  const [links, setLinks] = useState<{ sheet_id: string; session_id: string }[]>([])
  const { session } = useAuth()
  const { sessions, active } = useSessions()
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    supabase
      .from('exercise_sheets')
      .select('*, exercises(count)')
      .order('created_at', { ascending: false })
      .then(({ data }) => setSheets((data as never) ?? []))
    supabase
      .from('session_sheets')
      .select('sheet_id, session_id')
      .then(({ data }) => setLinks((data as never) ?? []))
  }, [])

  // Mis hojas: las que creé y las asignadas a sesiones donde soy profe (las publicadas de otros no).
  const title = (id: string) => sessions.find((x) => x.id === id)?.title
  const mine = (sheets ?? []).filter((s) => s.created_by === session?.user.id || links.some((l) => l.sheet_id === s.id))

  async function create() {
    setCreating(true)
    const { data, error } = await supabase.from('exercise_sheets').insert({ title: 'Nueva hoja' }).select('id').single()
    // Nace asignada a la sesión activa.
    if (!error && data && active) await supabase.from('session_sheets').insert({ session_id: active.id, sheet_id: data.id })
    setCreating(false)
    if (!error && data) navigate(`/profesor/ejercicios/${data.id}?editar`)
  }

  return (
    <Page>
      <div className="page-head">
        <h1>Ejercicios</h1>
        <button className={`btn btn-primary${creating ? ' is-busy' : ''}`} onClick={create} disabled={creating}>
          Nueva hoja
        </button>
      </div>
      {sheets === null ? (
        <div className="skeleton-list" />
      ) : mine.length === 0 ? (
        <button className="empty" onClick={create}>
          <span className="empty-plus">+</span>
          Crea tu primera hoja de ejercicios
        </button>
      ) : (
        <ul className="live-list">
          {mine.map((s) => (
            <li key={s.id}>
              <button className="live-row sheet-row" onClick={() => navigate(`/profesor/ejercicios/${s.id}`)}>
                <span className={`pub-dot${s.published ? ' is-on' : ''}`} title={s.published ? 'Publicada' : 'Borrador'} />
                <span className="live-owner">
                  {s.title}
                  {links
                    .filter((l) => l.sheet_id === s.id)
                    .map((l) => title(l.session_id))
                    .filter(Boolean)
                    .map((t) => (
                      <span key={t} className="tag tag-muted session-tag">
                        {t}
                      </span>
                    ))}
                </span>
                <span className="live-title">{s.exercises?.[0]?.count ?? 0} ejercicios</span>
                <span className="live-time">{timeAgo(s.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
