import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Sheet } from '../lib/exercises'
import { timeAgo } from '../lib/export'
import { Page } from '../components/Layout'

export function TeacherSheets() {
  const navigate = useNavigate()
  const [sheets, setSheets] = useState<(Sheet & { exercises: { count: number }[] })[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    supabase
      .from('exercise_sheets')
      .select('*, exercises(count)')
      .order('created_at', { ascending: false })
      .then(({ data }) => setSheets((data as never) ?? []))
  }, [])

  async function create() {
    setCreating(true)
    const { data, error } = await supabase.from('exercise_sheets').insert({ title: 'Nueva hoja' }).select('id').single()
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
      ) : sheets.length === 0 ? (
        <button className="empty" onClick={create}>
          <span className="empty-plus">+</span>
          Crea tu primera hoja de ejercicios
        </button>
      ) : (
        <ul className="live-list">
          {sheets.map((s) => (
            <li key={s.id}>
              <button className="live-row sheet-row" onClick={() => navigate(`/profesor/ejercicios/${s.id}`)}>
                <span className={`pub-dot${s.published ? ' is-on' : ''}`} title={s.published ? 'Publicada' : 'Borrador'} />
                <span className="live-owner">{s.title}</span>
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
