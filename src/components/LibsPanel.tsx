import { useState } from 'react'
import { LIBS, resolveLib } from '../lib/libs'

interface Props {
  libs: string[]
  readOnly?: boolean
  onChange: (libs: string[]) => void
  onClose: () => void
}

export function LibsPanel({ libs, readOnly, onChange, onClose }: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const on = new Set(libs)
  const custom = libs.filter((l) => l.startsWith('url:'))

  function toggle(id: string) {
    if (readOnly) return
    onChange(on.has(id) ? libs.filter((l) => l !== id) : [...libs, id])
  }

  function addUrl(e: React.FormEvent) {
    e.preventDefault()
    const id = `url:${url.trim()}`
    if (!resolveLib(id)) return setError('Tiene que ser una URL https de un .css o .js')
    if (!on.has(id)) onChange([...libs, id])
    setUrl('')
    setError(null)
  }

  const groups: [string, typeof LIBS][] = [
    ['CSS', LIBS.filter((l) => l.kind === 'css')],
    ['JS', LIBS.filter((l) => l.kind === 'js')],
    ['Google Fonts', LIBS.filter((l) => l.kind === 'font')],
  ]

  return (
    <div className="drawer" role="dialog" aria-label="Librerías">
      <header className="drawer-header">
        <h2>Librerías</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </header>
      {groups.map(([title, items]) => (
        <section key={title} className="lib-group">
          <h3>{title}</h3>
          <div className="chips">
            {items.map((l) => (
              <button
                key={l.id}
                className={`chip${on.has(l.id) ? ' is-on' : ''}`}
                onClick={() => toggle(l.id)}
                disabled={readOnly}
                style={l.kind === 'font' ? { fontFamily: `'${l.name}', var(--font)` } : undefined}
              >
                {l.name}
              </button>
            ))}
          </div>
        </section>
      ))}
      {custom.length > 0 && (
        <ul className="file-list">
          {custom.map((id) => (
            <li key={id} className="file-item">
              <span className="file-name" title={id.slice(4)}>
                {resolveLib(id)?.name}
              </span>
              {!readOnly && (
                <button className="icon-btn" onClick={() => toggle(id)} aria-label="Quitar">
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form onSubmit={addUrl} className="lib-url">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/libreria.css" spellCheck={false} />
          <button className="btn btn-ghost btn-sm" disabled={!url.trim()}>
            Añadir
          </button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
