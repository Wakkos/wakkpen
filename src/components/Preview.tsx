import { useEffect, useRef, useState } from 'react'
import type { ConsoleEntry, CssLang } from '../lib/types'
import { compileStyles } from '../lib/scss'
import { buildPreviewDoc } from '../lib/preview'

interface Props {
  html: string
  css: string
  cssLang: CssLang
  js: string
  delay?: number
}

let nextId = 1

export function Preview({ html, css, cssLang, js, delay = 800 }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [doc, setDoc] = useState('')
  const [entries, setEntries] = useState<ConsoleEntry[]>([])
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setPending(true)
    let cancelled = false
    const t = setTimeout(async () => {
      const compiled = await compileStyles(css, cssLang)
      if (cancelled) return
      setEntries(compiled.error ? [{ id: nextId++, level: 'error', text: compiled.error }] : [])
      setDoc(buildPreviewDoc(html, compiled.css, js))
      setPending(false)
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [html, css, cssLang, js, delay])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { source?: string; level?: ConsoleEntry['level']; text?: string }
      if (d?.source !== 'wakkpen-preview' || !d.level) return
      setEntries((prev) => [...prev.slice(-199), { id: nextId++, level: d.level!, text: d.text ?? '' }])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const errors = entries.filter((e) => e.level === 'error').length

  return (
    <div className="preview">
      <div className={`preview-frame${pending ? ' is-pending' : ''}`}>
        <iframe ref={frame} title="Vista previa" sandbox="allow-scripts allow-modals" srcDoc={doc} />
      </div>
      <div className={`console${open ? ' is-open' : ''}`}>
        <button className="console-toggle" onClick={() => setOpen((o) => !o)}>
          Consola
          {entries.length > 0 && <span className={`badge${errors ? ' badge-error' : ''}`}>{entries.length}</span>}
        </button>
        {open && (
          <div className="console-body">
            {entries.map((e) => (
              <div key={e.id} className={`console-line console-${e.level}`}>
                {e.text}
              </div>
            ))}
            {entries.length > 0 && (
              <button className="console-clear" onClick={() => setEntries([])}>
                Limpiar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
