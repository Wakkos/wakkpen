import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Pen, Profile } from '../lib/types'
import { timeAgo } from '../lib/export'
import { useEditingPresence, useNow } from '../lib/useLive'
import { LiveDot } from '../components/StatusDot'
import { Page } from '../components/Layout'

type PenRow = Pick<Pen, 'id' | 'owner_id' | 'title' | 'css_lang' | 'updated_at'>
const COLS = 'id, owner_id, title, css_lang, updated_at'

export function Teacher() {
  const navigate = useNavigate()
  const [pens, setPens] = useState<PenRow[] | null>(null)
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [filter, setFilter] = useState('')
  const [flash, setFlash] = useState<Record<string, number>>({})
  const live = useEditingPresence()
  const now = useNow()

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => setProfiles(Object.fromEntries(((data as Profile[]) ?? []).map((p) => [p.id, p]))))
    supabase
      .from('pens')
      .select(COLS)
      .order('updated_at', { ascending: false })
      .then(({ data }) => setPens((data as PenRow[]) ?? []))

    const channel = supabase
      .channel('teacher-pens')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pens' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldId = (payload.old as { id?: string }).id
          setPens((prev) => prev?.filter((p) => p.id !== oldId) ?? prev)
          return
        }
        const row = payload.new as Pen
        const slim: PenRow = { id: row.id, owner_id: row.owner_id, title: row.title, css_lang: row.css_lang, updated_at: row.updated_at }
        setPens((prev) => {
          const rest = (prev ?? []).filter((p) => p.id !== slim.id)
          return [slim, ...rest]
        })
        setFlash((f) => ({ ...f, [slim.id]: Date.now() }))
        if (payload.eventType === 'INSERT') {
          supabase
            .from('profiles')
            .select('*')
            .eq('id', slim.owner_id)
            .maybeSingle()
            .then(({ data }) => data && setProfiles((p) => ({ ...p, [data.id]: data as Profile })))
        }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const students = useMemo(
    () => Object.values(profiles).filter((p) => p.role === 'student').sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [profiles],
  )
  const shown = (pens ?? []).filter((p) => !filter || p.owner_id === filter)
  const activeCount = Object.keys(live).length

  return (
    <Page>
      <div className="page-head">
        <h1>
          En vivo
          {activeCount > 0 && <span className="count-live">{activeCount}</span>}
        </h1>
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar por alumno">
          <option value="">Todos</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </div>
      {pens === null ? (
        <div className="skeleton-list" />
      ) : shown.length === 0 ? (
        <p className="muted">Aún no hay pens.</p>
      ) : (
        <ul className="live-list">
          {shown.map((p) => {
            const owner = profiles[p.owner_id]
            const info = live[p.id]
            return (
              <li key={p.id}>
                <button
                  key={flash[p.id] ?? 0}
                  className={`live-row${flash[p.id] ? ' is-flash' : ''}`}
                  onClick={() => navigate(`/profesor/pen/${p.id}`)}
                >
                  <LiveDot active={!!info} typing={info?.typing} />
                  <span className="live-owner">{owner?.nombre ?? '…'}</span>
                  <span className="live-title">{p.title}</span>
                  <span className="live-tag">{p.css_lang === 'scss' && <span className="tag">SCSS</span>}</span>
                  <span className="live-time">{timeAgo(p.updated_at, now)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}
