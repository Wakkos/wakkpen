import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Pen, Profile, Snapshot } from '../lib/types'
import { CodeEditor } from '../components/CodeEditor'
import { Preview } from '../components/Preview'
import { Workspace } from '../components/Workspace'
import { TopBar } from '../components/Layout'

const SPEEDS = [1, 4, 8, 16]

// Reproduce cómo se construyó un pen a partir de las copias que se guardan mientras el alumno escribe.
export function History() {
  const { id } = useParams<{ id: string }>()
  const [pen, setPen] = useState<Pen | null>(null)
  const [owner, setOwner] = useState<Profile | null>(null)
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null)
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!id) return
    supabase
      .from('pens')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setPen(data as Pen)
        supabase.from('profiles').select('*').eq('id', (data as Pen).owner_id).maybeSingle().then(({ data: o }) => setOwner(o as Profile))
      })
    supabase
      .from('pen_snapshots')
      .select('id, html, css, css_lang, js, created_at')
      .eq('pen_id', id)
      .order('created_at', { ascending: true })
      .limit(5000)
      .then(({ data }) => {
        const list = (data as Snapshot[]) ?? []
        setSnaps(list)
        setI(Math.max(0, list.length - 1))
      })
  }, [id])

  useEffect(() => {
    if (!playing || !snaps?.length) return
    timer.current = setInterval(() => {
      setI((n) => {
        if (n >= snaps.length - 1) {
          setPlaying(false)
          return n
        }
        return n + 1
      })
    }, 1000 / speed)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [playing, speed, snaps])

  if (!pen || !snaps) return <div className="app-loading" />

  const s = snaps[i]
  const fmt = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })

  function play() {
    if (!snaps) return
    if (i >= snaps.length - 1) setI(0)
    setPlaying((p) => !p)
  }

  return (
    <div className="app app-editor">
      <TopBar>
        <div className="editor-bar">
          <Link to={`/profesor/pen/${pen.id}`} className="viewer-owner link-plain">
            ‹ {owner?.nombre ?? '…'}
          </Link>
          <span className="viewer-title">{pen.title}</span>
        </div>
      </TopBar>
      {snaps.length === 0 ? (
        <main className="page">
          <p className="muted">Aún no hay historial. Se guarda una copia cada 15 segundos mientras el alumno escribe.</p>
        </main>
      ) : (
        <>
          <div className="history-bar">
            <button className={`btn btn-primary btn-sm play-btn${playing ? ' is-playing' : ''}`} onClick={play} aria-label={playing ? 'Pausa' : 'Reproducir'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <input
              type="range"
              className="scrubber"
              min={0}
              max={snaps.length - 1}
              value={i}
              onChange={(e) => {
                setPlaying(false)
                setI(Number(e.target.value))
              }}
            />
            <span className="history-time">{fmt(s.created_at)}</span>
            <span className="muted history-count">
              {i + 1}/{snaps.length}
            </span>
            <div className="seg">
              {SPEEDS.map((x) => (
                <button key={x} className={speed === x ? 'is-on' : ''} onClick={() => setSpeed(x)}>
                  ×{x}
                </button>
              ))}
            </div>
          </div>
          <Workspace
            panes={[
              { key: 'html', header: <span className="pane-title">HTML</span>, body: <CodeEditor lang="html" value={s.html} readOnly /> },
              {
                key: 'css',
                header: <span className="pane-title">{s.css_lang.toUpperCase()}</span>,
                body: <CodeEditor lang={s.css_lang === 'scss' ? 'scss' : 'css'} value={s.css} readOnly />,
              },
              { key: 'js', header: <span className="pane-title">JS</span>, body: <CodeEditor lang="js" value={s.js} readOnly /> },
            ]}
            preview={<Preview html={s.html} css={s.css} cssLang={s.css_lang} js={s.js} libs={pen.libs} delay={120} />}
          />
        </>
      )}
    </div>
  )
}
