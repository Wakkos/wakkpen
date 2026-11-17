import { useEffect, useRef, useState, type ReactNode } from 'react'

// Paneles de código + vista previa. La vista previa va abajo o a la derecha; los paneles ocultos no ocupan sitio.
export type Layout = 'bottom' | 'right'

interface Pane {
  key: string
  header: ReactNode
  body: ReactNode
  hidden?: boolean
}

interface Props {
  panes: Pane[]
  preview: ReactNode
  layout?: Layout
}

function drag(e: React.PointerEvent, el: HTMLElement | null, onMove: (dx: number, dy: number, rect: DOMRect) => void) {
  const rect = el?.getBoundingClientRect()
  if (!rect) return
  e.preventDefault()
  const startX = e.clientX
  const startY = e.clientY
  document.body.classList.add('is-dragging')
  const move = (ev: PointerEvent) => onMove(ev.clientX - startX, ev.clientY - startY, rect)
  const up = () => {
    document.body.classList.remove('is-dragging')
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const MIN = 10

export function Workspace({ panes, preview, layout = 'bottom' }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(48)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const visible = panes.filter((p) => !p.hidden)
  const horizontal = layout === 'bottom' // paneles uno al lado del otro

  // Al cambiar los paneles visibles, se reparten a partes iguales.
  const visibleKey = visible.map((p) => p.key).join(',')
  useEffect(() => {
    setWeights(Object.fromEntries(visible.map((p) => [p.key, 100 / Math.max(1, visible.length)])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey])

  function startSplit(e: React.PointerEvent) {
    const start = split
    drag(e, root.current, (dx, dy, rect) => {
      const pct = horizontal ? start + (dy / rect.height) * 100 : start + (dx / rect.width) * 100
      setSplit(Math.min(85, Math.max(15, pct)))
    })
  }

  function startPane(i: number, e: React.PointerEvent) {
    const a = visible[i].key
    const b = visible[i + 1].key
    const base = { ...weights }
    const pair = (base[a] ?? 0) + (base[b] ?? 0)
    drag(e, area.current, (dx, dy, rect) => {
      const delta = horizontal ? (dx / rect.width) * 100 : (dy / rect.height) * 100
      const wa = Math.min(pair - MIN, Math.max(MIN, (base[a] ?? 0) + delta))
      setWeights({ ...base, [a]: wa, [b]: pair - wa })
    })
  }

  const hasCode = visible.length > 0

  return (
    <div className={`workspace layout-${layout}`} ref={root}>
      {hasCode && (
        <div
          className={`workspace-code ${horizontal ? 'is-row' : 'is-col'}`}
          style={horizontal ? { height: `${split}%` } : { width: `${split}%` }}
          ref={area}
        >
          {visible.map((p, i) => (
            <div key={p.key} className="pane-wrap" style={{ flexBasis: `${weights[p.key] ?? 100 / visible.length}%` }}>
              <section className="pane">
                <header className="pane-header">{p.header}</header>
                <div className="pane-body">{p.body}</div>
              </section>
              {i < visible.length - 1 && (
                <div className={`divider ${horizontal ? 'divider-v' : 'divider-h'}`} onPointerDown={(e) => startPane(i, e)} />
              )}
            </div>
          ))}
        </div>
      )}
      {hasCode && <div className={`divider ${horizontal ? 'divider-h' : 'divider-v'}`} onPointerDown={startSplit} />}
      <div className="workspace-preview">{preview}</div>
    </div>
  )
}
