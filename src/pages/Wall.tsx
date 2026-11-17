import { useEffect, useMemo, useRef, useState } from 'react'
import type { Pen, Profile } from '../lib/types'
import { useClassroom, byHandThenName } from '../lib/useClass'
import { useEditingPresence, useNow } from '../lib/useLive'
import { timeAgo } from '../lib/export'
import { Preview } from '../components/Preview'
import { LiveDot } from '../components/StatusDot'
import { TopBar } from '../components/Layout'

const BASE_W = 1280
const BASE_H = 800

function Scaled({ pen }: { pen: Pen }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.25)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / BASE_W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="wall-thumb" ref={box} style={{ height: BASE_H * scale }}>
      <div className="wall-thumb-inner" style={{ width: BASE_W, height: BASE_H, transform: `scale(${scale})` }}>
        <Preview html={pen.html} css={pen.css} cssLang={pen.css_lang} js={pen.js} libs={pen.libs} delay={600} bare />
      </div>
    </div>
  )
}

export function Wall() {
  const { profiles, pens, flash, lowerHand } = useClassroom()
  const live = useEditingPresence()
  const now = useNow()
  const [mode, setMode] = useState<'latest' | 'all'>('latest')
  const [focus, setFocus] = useState<string | null>(null)

  const cards = useMemo(() => {
    const list = (pens ?? []).filter((p) => profiles[p.owner_id]?.role !== 'teacher')
    const chosen =
      mode === 'all'
        ? list
        : Object.values(
            list.reduce<Record<string, Pen>>((acc, p) => {
              if (!acc[p.owner_id] || acc[p.owner_id].updated_at < p.updated_at) acc[p.owner_id] = p
              return acc
            }, {}),
          )
    return chosen.sort((a, b) => byHandThenName(profiles[a.owner_id], profiles[b.owner_id]) || b.updated_at.localeCompare(a.updated_at))
  }, [pens, profiles, mode])

  const idx = cards.findIndex((c) => c.id === focus)
  const focused = idx >= 0 ? cards[idx] : null

  useEffect(() => {
    if (!focused) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFocus(null)
      if (e.key === 'ArrowRight') setFocus(cards[(idx + 1) % cards.length].id)
      if (e.key === 'ArrowLeft') setFocus(cards[(idx - 1 + cards.length) % cards.length].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, idx, cards])

  const owner = (p: Pen): Profile | undefined => profiles[p.owner_id]

  return (
    <div className="app">
      <TopBar />
      <main className="wall">
        <div className="page-head">
          <h1>Muro</h1>
          <div className="seg">
            <button className={mode === 'latest' ? 'is-on' : ''} onClick={() => setMode('latest')}>
              Último por alumno
            </button>
            <button className={mode === 'all' ? 'is-on' : ''} onClick={() => setMode('all')}>
              Todos
            </button>
          </div>
        </div>
        {pens === null ? (
          <div className="skeleton-list" />
        ) : cards.length === 0 ? (
          <p className="muted">Aún no hay pens de alumnos.</p>
        ) : (
          <div className="wall-grid">
            {cards.map((p) => {
              const o = owner(p)
              const info = live[p.id]
              const raised = !!o?.hand_raised_at
              return (
                <article key={p.id} className={`wall-card${raised ? ' is-raised' : ''}`}>
                  <button className="wall-open" onClick={() => setFocus(p.id)} aria-label={`Abrir ${o?.nombre}`}>
                    <Scaled pen={p} />
                  </button>
                  <footer key={flash[p.id] ?? 0} className={`wall-meta${flash[p.id] ? ' is-flash' : ''}`}>
                    <LiveDot active={!!info} typing={info?.typing} />
                    <span className="wall-name">{o?.nombre ?? '…'}</span>
                    <span className="wall-title">{p.title}</span>
                    {raised ? (
                      <button className="hand-chip" onClick={() => lowerHand(p.owner_id)} title="Bajar la mano">
                        ✋ {timeAgo(o!.hand_raised_at!, now)}
                      </button>
                    ) : (
                      <span className="wall-time">{timeAgo(p.updated_at, now)}</span>
                    )}
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </main>

      {focused && (
        <div className="wall-focus" role="dialog" aria-label={owner(focused)?.nombre}>
          <header className="wall-focus-bar">
            <LiveDot active={!!live[focused.id]} typing={live[focused.id]?.typing} />
            <strong>{owner(focused)?.nombre}</strong>
            <span className="muted">{focused.title}</span>
            {owner(focused)?.hand_raised_at && (
              <button className="hand-chip" onClick={() => lowerHand(focused.owner_id)}>
                ✋ Bajar la mano
              </button>
            )}
            <span className="wall-focus-nav">
              <button className="icon-btn" onClick={() => setFocus(cards[(idx - 1 + cards.length) % cards.length].id)} aria-label="Anterior">
                ‹
              </button>
              <span className="muted">
                {idx + 1}/{cards.length}
              </span>
              <button className="icon-btn" onClick={() => setFocus(cards[(idx + 1) % cards.length].id)} aria-label="Siguiente">
                ›
              </button>
              <a className="btn btn-ghost btn-sm" href={`/profesor/pen/${focused.id}`}>
                Código
              </a>
              <button className="icon-btn" onClick={() => setFocus(null)} aria-label="Cerrar">
                ×
              </button>
            </span>
          </header>
          <div className="wall-focus-body">
            <Preview html={focused.html} css={focused.css} cssLang={focused.css_lang} js={focused.js} libs={focused.libs} delay={300} />
          </div>
        </div>
      )}
    </div>
  )
}
