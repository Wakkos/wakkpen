import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { CssLang, Pen, SaveState } from '../lib/types'
import { joinEditing } from '../lib/presence'
import { exportPen } from '../lib/export'
import { liveSender, popoutChannel, type LivePayload } from '../lib/live'
import { CodeEditor } from '../components/CodeEditor'
import { Preview } from '../components/Preview'
import { Workspace, type Layout } from '../components/Workspace'
import { StatusDot } from '../components/StatusDot'
import { FilesPanel } from '../components/FilesPanel'
import { GitHubPanel, GitHubMark } from '../components/GitHubPanel'
import { LibsPanel } from '../components/LibsPanel'
import { QrPanel } from '../components/QrPanel'
import { HandButton } from '../components/HandButton'
import { PaneToggles, LayoutToggle, IconPopout, IconQr, usePref } from '../components/EditorChrome'
import { TopBar } from '../components/Layout'

type Fields = Pick<Pen, 'title' | 'html' | 'css' | 'css_lang' | 'js' | 'libs'>
type PanelName = 'files' | 'github' | 'libs' | 'qr' | null
const SAVE_DELAY = 1500
const SNAPSHOT_EVERY = 15000

export function Editor() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const [pen, setPen] = useState<Pen | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [fields, setFields] = useState<Fields | null>(null)
  const [save, setSave] = useState<SaveState>('idle')
  const [panel, setPanel] = useState<PanelName>(null)
  const [exporting, setExporting] = useState(false)
  const [hidden, setHidden] = usePref<string[]>('wakkpen:hidden', [])
  const [layout, setLayout] = usePref<Layout>('wakkpen:layout', 'bottom')
  const [viewers, setViewers] = useState(0)

  const latest = useRef<Fields | null>(null)
  const dirty = useRef(false)
  const saving = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presence = useRef<ReturnType<typeof joinEditing> | null>(null)
  const lastTyping = useRef(0)
  const lastSnap = useRef<{ at: number; key: string }>({ at: 0, key: '' })
  const live = useRef<ReturnType<typeof liveSender> | null>(null)
  const bc = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    if (!id) return
    supabase
      .from('pens')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return setNotFound(true)
        const p = data as Pen
        setPen(p)
        const f = { title: p.title, html: p.html, css: p.css, css_lang: p.css_lang, js: p.js, libs: p.libs ?? [] }
        setFields(f)
        latest.current = f
        lastSnap.current = { at: 0, key: snapKey(f) }
      })
  }, [id])

  const isOwner = !!pen && pen.owner_id === session?.user.id

  useEffect(() => {
    if (!isOwner || !session || !id) return
    presence.current = joinEditing(session.user.id, id)
    return () => {
      presence.current?.leave()
      presence.current = null
    }
  }, [isOwner, session, id])

  // Envío en vivo al móvil (QR).
  const liveToken = pen?.live_token
  useEffect(() => {
    if (!isOwner || !liveToken) return
    live.current = liveSender(liveToken)
    const t = setInterval(() => setViewers(live.current?.viewers() ?? 0), 2000)
    return () => {
      clearInterval(t)
      live.current?.leave()
      live.current = null
    }
  }, [isOwner, liveToken])

  // Ventana aparte (mismo navegador).
  useEffect(() => {
    if (!id) return
    const ch = popoutChannel(id)
    bc.current = ch
    ch.onmessage = (e) => {
      if (e.data === 'hello' && latest.current) ch.postMessage(payload(latest.current))
    }
    return () => {
      ch.close()
      bc.current = null
    }
  }, [id])

  // Cada cambio llega a la ventana aparte enseguida y al móvil con un pequeño retardo.
  useEffect(() => {
    if (!fields) return
    bc.current?.postMessage(payload(fields))
    const t = setTimeout(() => live.current?.update(payload(fields)), 400)
    return () => clearTimeout(t)
  }, [fields])

  const snapshot = useCallback(async () => {
    const f = latest.current
    if (!id || !f || !isOwner) return
    const key = snapKey(f)
    const now = Date.now()
    if (key === lastSnap.current.key || now - lastSnap.current.at < SNAPSHOT_EVERY) return
    lastSnap.current = { at: now, key }
    await supabase.from('pen_snapshots').insert({ pen_id: id, html: f.html, css: f.css, css_lang: f.css_lang, js: f.js })
  }, [id, isOwner])

  const flush = useCallback(async () => {
    if (!id || !latest.current || saving.current || !dirty.current) return
    saving.current = true
    dirty.current = false
    setSave('saving')
    if (idleTimer.current) clearTimeout(idleTimer.current)
    const { error } = await supabase.from('pens').update(latest.current).eq('id', id)
    saving.current = false
    if (error) {
      dirty.current = true
      setSave('error')
      timer.current = setTimeout(flush, 5000)
      return
    }
    snapshot()
    if (dirty.current) {
      timer.current = setTimeout(flush, SAVE_DELAY)
      return
    }
    setSave('saved')
    idleTimer.current = setTimeout(() => setSave('idle'), 2500)
  }, [id, snapshot])

  const update = useCallback(
    (patch: Partial<Fields>) => {
      setFields((prev) => {
        if (!prev) return prev
        const next = { ...prev, ...patch }
        latest.current = next
        return next
      })
      dirty.current = true
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY)
      const now = Date.now()
      if (now - lastTyping.current > 3000) {
        lastTyping.current = now
        presence.current?.typing()
      }
    },
    [flush],
  )

  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirty.current || saving.current) {
        flush()
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      if (timer.current) clearTimeout(timer.current)
      if (idleTimer.current) clearTimeout(idleTimer.current)
      if (dirty.current && latest.current && id) supabase.from('pens').update(latest.current).eq('id', id).then()
    }
  }, [flush, id])

  async function onExport() {
    if (!pen || !latest.current) return
    setExporting(true)
    try {
      await exportPen({ ...pen, ...latest.current })
    } finally {
      setExporting(false)
    }
  }

  function openPopout() {
    if (!id) return
    window.open(`/pen/${id}/ventana`, `wakkpen-${id}`, 'popup,width=420,height=800')
  }

  if (notFound)
    return (
      <div className="app">
        <TopBar />
        <main className="page">
          <p>Este pen no existe.</p>
          <Link to="/pens">Volver</Link>
        </main>
      </div>
    )

  if (!fields || !pen || !session) return <div className="app-loading" />

  const readOnly = !isOwner
  const toggle = (name: Exclude<PanelName, null>) => setPanel((p) => (p === name ? null : name))

  return (
    <div className="app app-editor">
      <TopBar>
        <div className="editor-bar">
          <input
            className="title-input"
            value={fields.title}
            readOnly={readOnly}
            maxLength={120}
            onChange={(e) => update({ title: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && update({ title: 'Sin título' })}
            aria-label="Título"
          />
          {!readOnly && <StatusDot state={save} />}
          <PaneToggles hidden={hidden} onChange={setHidden} cssLang={fields.css_lang} />
          <div className="editor-actions">
            <button className={`btn btn-ghost btn-sm${fields.libs.length ? ' has-count' : ''}`} data-count={fields.libs.length} onClick={() => toggle('libs')}>
              Librerías
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => toggle('files')}>
              Archivos
            </button>
            {!readOnly && (
              <button className={`btn btn-ghost btn-sm${pen.gh_repo ? ' has-dot' : ''}`} onClick={() => toggle('github')}>
                <GitHubMark />
                GitHub
              </button>
            )}
            <button className={`btn btn-ghost btn-sm${exporting ? ' is-busy' : ''}`} onClick={onExport} disabled={exporting}>
              Exportar
            </button>
            {!readOnly && <HandButton />}
          </div>
        </div>
      </TopBar>
      <Workspace
        layout={layout}
        panes={[
          {
            key: 'html',
            hidden: hidden.includes('html'),
            header: <span className="pane-title">HTML</span>,
            body: <CodeEditor lang="html" value={fields.html} readOnly={readOnly} onChange={(html) => update({ html })} />,
          },
          {
            key: 'css',
            hidden: hidden.includes('css'),
            header: (
              <div className="seg" role="tablist">
                {(['css', 'scss'] as CssLang[]).map((l) => (
                  <button
                    key={l}
                    role="tab"
                    aria-selected={fields.css_lang === l}
                    className={fields.css_lang === l ? 'is-on' : ''}
                    disabled={readOnly}
                    onClick={() => update({ css_lang: l })}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            ),
            body: (
              <CodeEditor
                lang={fields.css_lang === 'scss' ? 'scss' : 'css'}
                value={fields.css}
                readOnly={readOnly}
                onChange={(css) => update({ css })}
              />
            ),
          },
          {
            key: 'js',
            hidden: hidden.includes('js'),
            header: <span className="pane-title">JS</span>,
            body: <CodeEditor lang="js" value={fields.js} readOnly={readOnly} onChange={(js) => update({ js })} />,
          },
        ]}
        preview={
          <Preview
            html={fields.html}
            css={fields.css}
            cssLang={fields.css_lang}
            js={fields.js}
            libs={fields.libs}
            actions={
              <>
                <LayoutToggle layout={layout} onChange={setLayout} />
                <button className="icon-btn" onClick={openPopout} title="Abrir en otra ventana">
                  <IconPopout />
                </button>
                {!readOnly && (
                  <button className={`icon-btn${panel === 'qr' ? ' is-on' : ''}${viewers ? ' has-live' : ''}`} onClick={() => toggle('qr')} title="Ver en el móvil">
                    <IconQr />
                  </button>
                )}
              </>
            }
          />
        }
      />
      {panel === 'files' && <FilesPanel penId={pen.id} userId={session.user.id} readOnly={readOnly} onClose={() => setPanel(null)} />}
      {panel === 'libs' && <LibsPanel libs={fields.libs} readOnly={readOnly} onChange={(libs) => update({ libs })} onClose={() => setPanel(null)} />}
      {panel === 'github' && !readOnly && (
        <GitHubPanel pen={{ ...pen, ...fields }} onClose={() => setPanel(null)} onSaved={(patch) => setPen((p) => (p ? { ...p, ...patch } : p))} />
      )}
      {panel === 'qr' && !readOnly && (
        <QrPanel
          penId={pen.id}
          token={pen.live_token}
          viewers={viewers}
          onToken={(t) => setPen((p) => (p ? { ...p, live_token: t } : p))}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  )
}

function payload(f: Fields): LivePayload {
  return { title: f.title, html: f.html, css: f.css, css_lang: f.css_lang, js: f.js, libs: f.libs }
}

function snapKey(f: Fields) {
  return `${f.html.length}:${f.css.length}:${f.js.length}:${f.html}${f.css}${f.js}`
}
