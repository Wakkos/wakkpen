import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { CssLang, Pen, SaveState } from '../lib/types'
import { joinEditing } from '../lib/presence'
import { exportPen } from '../lib/export'
import { CodeEditor } from '../components/CodeEditor'
import { Preview } from '../components/Preview'
import { Workspace } from '../components/Workspace'
import { StatusDot } from '../components/StatusDot'
import { FilesPanel } from '../components/FilesPanel'
import { TopBar } from '../components/Layout'

type Fields = Pick<Pen, 'title' | 'html' | 'css' | 'css_lang' | 'js'>
const SAVE_DELAY = 1500

export function Editor() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const [pen, setPen] = useState<Pen | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [fields, setFields] = useState<Fields | null>(null)
  const [save, setSave] = useState<SaveState>('idle')
  const [filesOpen, setFilesOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const latest = useRef<Fields | null>(null)
  const dirty = useRef(false)
  const saving = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const presence = useRef<ReturnType<typeof joinEditing> | null>(null)
  const lastTyping = useRef(0)

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
        const f = { title: p.title, html: p.html, css: p.css, css_lang: p.css_lang, js: p.js }
        setFields(f)
        latest.current = f
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
    if (dirty.current) {
      timer.current = setTimeout(flush, SAVE_DELAY)
      return
    }
    setSave('saved')
    idleTimer.current = setTimeout(() => setSave('idle'), 2500)
  }, [id])

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

  // Guarda lo pendiente al salir de la página o cerrar la pestaña.
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
          <div className="editor-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setFilesOpen((o) => !o)}>
              Archivos
            </button>
            <button className={`btn btn-ghost btn-sm${exporting ? ' is-busy' : ''}`} onClick={onExport} disabled={exporting}>
              Exportar
            </button>
          </div>
        </div>
      </TopBar>
      <Workspace
        panes={[
          {
            key: 'html',
            header: <span className="pane-title">HTML</span>,
            body: <CodeEditor lang="html" value={fields.html} readOnly={readOnly} onChange={(html) => update({ html })} />,
          },
          {
            key: 'css',
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
            header: <span className="pane-title">JS</span>,
            body: <CodeEditor lang="js" value={fields.js} readOnly={readOnly} onChange={(js) => update({ js })} />,
          },
        ]}
        bottom={<Preview html={fields.html} css={fields.css} cssLang={fields.css_lang} js={fields.js} />}
      />
      {filesOpen && (
        <FilesPanel penId={pen.id} userId={session.user.id} readOnly={readOnly} onClose={() => setFilesOpen(false)} />
      )}
    </div>
  )
}
