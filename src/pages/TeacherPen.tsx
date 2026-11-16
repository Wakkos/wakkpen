import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Pen, Profile } from '../lib/types'
import { exportPen, timeAgo } from '../lib/export'
import { useEditingPresence, useNow } from '../lib/useLive'
import { CodeEditor } from '../components/CodeEditor'
import { Preview } from '../components/Preview'
import { Workspace } from '../components/Workspace'
import { LiveDot } from '../components/StatusDot'
import { FilesPanel } from '../components/FilesPanel'
import { GitHubMark } from '../components/GitHubPanel'
import { TopBar } from '../components/Layout'

export function TeacherPen() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const [pen, setPen] = useState<Pen | null>(null)
  const [owner, setOwner] = useState<Profile | null>(null)
  const [missing, setMissing] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const live = useEditingPresence()
  const now = useNow(5000)

  useEffect(() => {
    if (!id) return
    supabase
      .from('pens')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return setMissing(true)
        setPen(data as Pen)
        supabase
          .from('profiles')
          .select('*')
          .eq('id', (data as Pen).owner_id)
          .maybeSingle()
          .then(({ data: p }) => setOwner((p as Profile) ?? null))
      })

    const channel = supabase
      .channel(`teacher-pen-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pens', filter: `id=eq.${id}` }, (payload) => {
        if (payload.eventType === 'DELETE') return setMissing(true)
        setPen(payload.new as Pen)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id])

  if (missing)
    return (
      <div className="app">
        <TopBar />
        <main className="page">
          <p>Este pen ya no existe.</p>
          <Link to="/profesor">Volver</Link>
        </main>
      </div>
    )

  if (!pen || !session) return <div className="app-loading" />

  const info = id ? live[id] : undefined

  async function onExport() {
    if (!pen) return
    setExporting(true)
    try {
      await exportPen(pen)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app app-editor">
      <TopBar>
        <div className="editor-bar">
          <LiveDot active={!!info} typing={info?.typing} />
          <span className="viewer-owner">{owner?.nombre ?? '…'}</span>
          <span className="viewer-title">{pen.title}</span>
          <span className="viewer-time">{timeAgo(pen.updated_at, now)}</span>
          <div className="editor-actions">
            {pen.gh_repo && (
              <a
                className="btn btn-ghost btn-sm"
                href={pen.gh_commit_sha ? `https://github.com/${pen.gh_repo}/commit/${pen.gh_commit_sha}` : `https://github.com/${pen.gh_repo}`}
                target="_blank"
                rel="noreferrer"
                title={pen.gh_repo}
              >
                <GitHubMark />
                {pen.gh_commit_at ? timeAgo(pen.gh_commit_at, now) : 'GitHub'}
              </a>
            )}
            {pen.gh_pages_url && (
              <a className="btn btn-ghost btn-sm" href={pen.gh_pages_url} target="_blank" rel="noreferrer">
                Pages
              </a>
            )}
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
          { key: 'html', header: <span className="pane-title">HTML</span>, body: <CodeEditor lang="html" value={pen.html} readOnly /> },
          {
            key: 'css',
            header: <span className="pane-title">{pen.css_lang.toUpperCase()}</span>,
            body: <CodeEditor lang={pen.css_lang === 'scss' ? 'scss' : 'css'} value={pen.css} readOnly />,
          },
          { key: 'js', header: <span className="pane-title">JS</span>, body: <CodeEditor lang="js" value={pen.js} readOnly /> },
        ]}
        bottom={<Preview html={pen.html} css={pen.css} cssLang={pen.css_lang} js={pen.js} delay={300} />}
      />
      {filesOpen && <FilesPanel penId={pen.id} userId={session.user.id} readOnly onClose={() => setFilesOpen(false)} />}
    </div>
  )
}
