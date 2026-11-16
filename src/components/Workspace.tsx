import { useRef, useState, type ReactNode } from 'react'

// Tres paneles de código arriba y la vista previa abajo; los divisores se arrastran.
interface Props {
  panes: { key: string; header: ReactNode; body: ReactNode }[]
  bottom: ReactNode
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

export function Workspace({ panes, bottom }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const [topPct, setTopPct] = useState(48)
  const [cols, setCols] = useState<number[]>(() => panes.map(() => 100 / panes.length))

  function startRow(e: React.PointerEvent) {
    const start = topPct
    drag(e, root.current, (_dx, dy, rect) => {
      setTopPct(Math.min(85, Math.max(15, start + (dy / rect.height) * 100)))
    })
  }

  function startCol(i: number, e: React.PointerEvent) {
    const base = cols
    const pair = base[i] + base[i + 1]
    drag(e, row.current, (dx, _dy, rect) => {
      const a = Math.min(pair - MIN, Math.max(MIN, base[i] + (dx / rect.width) * 100))
      const next = [...base]
      next[i] = a
      next[i + 1] = pair - a
      setCols(next)
    })
  }

  return (
    <div className="workspace" ref={root}>
      <div className="workspace-top" style={{ height: `${topPct}%` }} ref={row}>
        {panes.map((p, i) => (
          <div key={p.key} className="pane-wrap" style={{ width: `${cols[i]}%` }}>
            <section className="pane">
              <header className="pane-header">{p.header}</header>
              <div className="pane-body">{p.body}</div>
            </section>
            {i < panes.length - 1 && <div className="divider divider-v" onPointerDown={(e) => startCol(i, e)} />}
          </div>
        ))}
      </div>
      <div className="divider divider-h" onPointerDown={startRow} />
      <div className="workspace-bottom">{bottom}</div>
    </div>
  )
}
