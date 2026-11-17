import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { timeAgo } from '../lib/export'
import { useEditingPresence, useNow } from '../lib/useLive'
import { useClassroom } from '../lib/useClass'
import { LiveDot } from '../components/StatusDot'
import { GitHubMark } from '../components/GitHubPanel'
import { Page } from '../components/Layout'

export function Teacher() {
  const navigate = useNavigate()
  const { profiles, pens, flash, lowerHand } = useClassroom()
  const [filter, setFilter] = useState('')
  const live = useEditingPresence()
  const now = useNow()

  const students = useMemo(
    () => Object.values(profiles).filter((p) => p.role === 'student').sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [profiles],
  )
  const hands = students.filter((s) => s.hand_raised_at).sort((a, b) => a.hand_raised_at!.localeCompare(b.hand_raised_at!))
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

      {hands.length > 0 && (
        <div className="hands">
          {hands.map((s) => (
            <button key={s.id} className="hand-chip is-big" onClick={() => lowerHand(s.id)} title="Bajar la mano">
              ✋ <strong>{s.nombre}</strong> <span>{timeAgo(s.hand_raised_at!, now)}</span>
            </button>
          ))}
        </div>
      )}

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
                  className={`live-row${flash[p.id] ? ' is-flash' : ''}${owner?.hand_raised_at ? ' is-raised' : ''}`}
                  onClick={() => navigate(`/profesor/pen/${p.id}`)}
                >
                  <LiveDot active={!!info} typing={info?.typing} />
                  <span className="live-owner">
                    {owner?.hand_raised_at && <span aria-hidden>✋ </span>}
                    {owner?.nombre ?? '…'}
                  </span>
                  <span className="live-title">{p.title}</span>
                  <span className="live-tag">
                    {p.gh_repo && (
                      <span className="gh-flag" title={p.gh_repo}>
                        <GitHubMark size={13} />
                      </span>
                    )}
                    {p.css_lang === 'scss' && <span className="tag">SCSS</span>}
                  </span>
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
