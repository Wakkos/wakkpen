import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Profile } from '../lib/types'
import { timeAgo } from '../lib/export'
import { Page } from '../components/Layout'
import { ALL, useSessions } from '../lib/sessions'

export function Students() {
  const { session } = useAuth()
  const [people, setPeople] = useState<Profile[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { active, activeId, inActive, members } = useSessions()

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setPeople((data as Profile[]) ?? []))
    supabase
      .from('pens')
      .select('owner_id')
      .then(({ data }) => {
        const c: Record<string, number> = {}
        for (const r of (data as { owner_id: string }[]) ?? []) c[r.owner_id] = (c[r.owner_id] ?? 0) + 1
        setCounts(c)
      })
  }, [])

  async function remove(p: Profile) {
    if (!confirm(`¿Borrar a ${p.email}? Se borran también sus pens y archivos.`)) return
    setBusy(p.id)
    setError(null)
    const { error } = await supabase.functions.invoke('delete-user', { body: { user_id: p.id } })
    setBusy(null)
    if (error) return setError(error.message)
    setPeople((prev) => prev?.filter((x) => x.id !== p.id) ?? null)
  }

  // Alumnos de la sesión activa y, aparte, los que no están en ninguna (recién dados de alta).
  const inAnySession = (id: string) => Object.values(members).some((m) => m.has(id))
  const students = (people ?? []).filter((p) => p.role === 'student')
  const groups = [
    { key: 'session', title: activeId === ALL ? 'En mis sesiones' : (active?.title ?? 'Sesión'), list: students.filter((p) => inActive(p.id)) },
    { key: 'none', title: 'Sin sesión', list: students.filter((p) => !inAnySession(p.id)) },
  ].filter((g) => g.key === 'session' || g.list.length)

  return (
    <Page>
      <div className="page-head">
        <h1>Alumnos</h1>
      </div>
      {error && <p className="form-error">{error}</p>}
      {people === null ? (
        <div className="skeleton-list" />
      ) : (
        groups.map((g) => (
          <section key={g.key} className="people-group">
            <h2 className="section-title">
              {g.title} <span className="muted">{g.list.length}</span>
            </h2>
            {g.list.length === 0 ? (
              <p className="muted">Nadie todavía.</p>
            ) : (
              <table className="table">
                <tbody>
                  {g.list.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.nombre}</strong>
                      </td>
                      <td className="muted">{p.email}</td>
                      <td className="num">
                        {counts[p.id] ?? 0} {(counts[p.id] ?? 0) === 1 ? 'pen' : 'pens'}
                      </td>
                      <td className="muted">{timeAgo(p.created_at)}</td>
                      <td className="actions">
                        {p.id !== session?.user.id && (
                          <button className={`btn btn-danger btn-sm${busy === p.id ? ' is-busy' : ''}`} disabled={busy === p.id} onClick={() => remove(p)}>
                            Borrar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))
      )}
    </Page>
  )
}
