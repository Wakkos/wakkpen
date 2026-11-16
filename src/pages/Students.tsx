import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Profile } from '../lib/types'
import { timeAgo } from '../lib/export'
import { Page } from '../components/Layout'

export function Students() {
  const { session } = useAuth()
  const [people, setPeople] = useState<Profile[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <Page>
      <div className="page-head">
        <h1>Alumnos</h1>
      </div>
      {error && <p className="form-error">{error}</p>}
      {people === null ? (
        <div className="skeleton-list" />
      ) : (
        <table className="table">
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.nombre}</strong>
                  {p.role === 'teacher' && <span className="tag">Profesor</span>}
                </td>
                <td className="muted">{p.email}</td>
                <td className="num">{counts[p.id] ?? 0} {(counts[p.id] ?? 0) === 1 ? 'pen' : 'pens'}</td>
                <td className="muted">{timeAgo(p.created_at)}</td>
                <td className="actions">
                  {p.id !== session?.user.id && (
                    <button
                      className={`btn btn-danger btn-sm${busy === p.id ? ' is-busy' : ''}`}
                      disabled={busy === p.id}
                      onClick={() => remove(p)}
                    >
                      Borrar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  )
}
