import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Pen } from '../lib/types'
import { deletePenWithFiles } from '../lib/files'
import { timeAgo } from '../lib/export'
import { Page } from '../components/Layout'
import { HandButton } from '../components/HandButton'

export function MyPens() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [pens, setPens] = useState<Pen[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    supabase
      .from('pens')
      .select('*')
      .eq('owner_id', session.user.id)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        setPens((data as Pen[]) ?? [])
      })
  }, [session])

  async function create() {
    setCreating(true)
    const { data, error } = await supabase.from('pens').insert({}).select('id').single()
    setCreating(false)
    if (error) return setError(error.message)
    navigate(`/pen/${data.id}`)
  }

  async function remove(pen: Pen) {
    if (!confirm(`¿Borrar "${pen.title}"? No se puede deshacer.`)) return
    try {
      await deletePenWithFiles(pen.id)
      setPens((prev) => prev?.filter((p) => p.id !== pen.id) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Page>
      <div className="page-head">
        <h1>Mis pens</h1>
        <div className="page-head-actions">
          <HandButton />
          <button className={`btn btn-primary${creating ? ' is-busy' : ''}`} onClick={create} disabled={creating}>
          Nuevo pen
          </button>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {pens === null ? (
        <div className="skeleton-list" />
      ) : pens.length === 0 ? (
        <button className="empty" onClick={create}>
          <span className="empty-plus">+</span>
          Crea tu primer pen
        </button>
      ) : (
        <ul className="pen-grid">
          {pens.map((p) => (
            <li key={p.id} className="pen-card">
              <button className="pen-card-main" onClick={() => navigate(`/pen/${p.id}`)}>
                <span className="pen-title">{p.title}</span>
                <span className="pen-meta">
                  {p.css_lang === 'scss' && <span className="tag">SCSS</span>}
                  {timeAgo(p.updated_at)}
                </span>
              </button>
              <button className="icon-btn pen-card-delete" onClick={() => remove(p)} aria-label={`Borrar ${p.title}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
