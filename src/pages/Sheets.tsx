import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Sheet } from '../lib/exercises'
import { Page } from '../components/Layout'

interface Row extends Sheet {
  exercises: { id: string }[]
}

export function Sheets() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [sheets, setSheets] = useState<Row[] | null>(null)
  const [done, setDone] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!session) return
    supabase
      .from('exercise_sheets')
      .select('*, exercises(id)')
      .eq('published', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSheets((data as Row[]) ?? []))
    supabase
      .from('submissions')
      .select('exercise_id')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        const ids = new Set(((data as { exercise_id: string }[]) ?? []).map((d) => d.exercise_id))
        setDone(Object.fromEntries([...ids].map((i) => [i, 1])))
      })
  }, [session])

  return (
    <Page>
      <div className="page-head">
        <h1>Ejercicios</h1>
      </div>
      {sheets === null ? (
        <div className="skeleton-list" />
      ) : sheets.length === 0 ? (
        <p className="muted">Todavía no hay ejercicios publicados.</p>
      ) : (
        <ul className="pen-grid">
          {sheets.map((s) => {
            const total = s.exercises.length
            const n = s.exercises.filter((e) => done[e.id]).length
            return (
              <li key={s.id} className="pen-card">
                <button className="pen-card-main" onClick={() => navigate(`/ejercicios/${s.id}`)}>
                  <span className="pen-title">{s.title}</span>
                  <span className="progress" aria-label={`${n} de ${total}`}>
                    <span style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
                  </span>
                  <span className="pen-meta">
                    {n}/{total}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}
