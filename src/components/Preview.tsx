import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CssLang } from '../lib/types'
import { compileStyles } from '../lib/scss'
import { buildPreviewDoc } from '../lib/preview'

interface Props {
  html: string
  css: string
  cssLang: CssLang
  js: string
  libs?: string[]
  delay?: number
  /** Sin barra de dispositivos (muro, móvil). */
  bare?: boolean
  /** Botones extra a la derecha de la barra. */
  actions?: ReactNode
}

const DEVICES: { label: string; width: number | null; icon: ReactNode }[] = [
  {
    label: 'Libre',
    width: null,
    icon: <svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2.5" width="13" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5 14h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
  {
    label: 'Tableta · 768',
    width: 768,
    icon: <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  },
  {
    label: 'Móvil · 375',
    width: 375,
    icon: <svg viewBox="0 0 16 16" width="14" height="14"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M7 12.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
]

export function Preview({ html, css, cssLang, js, libs, delay = 800, bare = false, actions }: Props) {
  const [doc, setDoc] = useState('')
  const [pending, setPending] = useState(false)
  const [scssError, setScssError] = useState<string | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [live, setLive] = useState(0)
  const stage = useRef<HTMLDivElement>(null)
  const libsKey = (libs ?? []).join('|')

  useEffect(() => {
    setPending(true)
    let cancelled = false
    const t = setTimeout(async () => {
      const compiled = await compileStyles(css, cssLang)
      if (cancelled) return
      setScssError(compiled.error)
      if (!compiled.error) setDoc(buildPreviewDoc(html, compiled.css, js, libs))
      setPending(false)
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, css, cssLang, js, libsKey, delay])

  // Ancho real del área cuando está en modo libre, para la regla.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setLive(Math.round(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function startResize(e: React.PointerEvent, side: 1 | -1) {
    e.preventDefault()
    const max = stage.current?.clientWidth ?? 2000
    const start = width ?? max
    const x0 = e.clientX
    document.body.classList.add('is-dragging')
    const move = (ev: PointerEvent) => setWidth(Math.round(Math.min(max, Math.max(240, start + (ev.clientX - x0) * 2 * side))))
    const up = () => {
      document.body.classList.remove('is-dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const shown = width ?? live

  return (
    <div className={`preview${bare ? ' is-bare' : ''}`}>
      {!bare && (
        <div className="preview-bar">
          <div className="seg">
            {DEVICES.map((d) => (
              <button key={d.label} className={width === d.width ? 'is-on' : ''} onClick={() => setWidth(d.width)} title={d.label}>
                {d.icon}
              </button>
            ))}
          </div>
          <span className="preview-width">{shown ? `${shown} px` : ''}</span>
          <div className="preview-actions">{actions}</div>
        </div>
      )}
      <div className={`preview-stage${width ? ' is-sized' : ''}`} ref={stage}>
        <div className={`preview-frame${pending ? ' is-pending' : ''}`} style={width ? { width } : undefined}>
          {width && <div className="resize-handle is-left" onPointerDown={(e) => startResize(e, -1)} />}
          <iframe title="Vista previa" sandbox="allow-scripts allow-modals" srcDoc={doc} />
          {width && <div className="resize-handle is-right" onPointerDown={(e) => startResize(e, 1)} />}
          {scssError && <div className="scss-error">{scssError}</div>}
        </div>
      </div>
    </div>
  )
}
