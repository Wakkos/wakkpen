import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Pen } from '../lib/types'
import {
  GitHubError,
  commitPen,
  connectGitHub,
  createRepo,
  disconnectGitHub,
  enablePages,
  getAccount,
  listBranches,
  listRepos,
  slugRepoName,
  type GitHubAccount,
  type RepoInfo,
} from '../lib/github'
import { timeAgo } from '../lib/export'

type GhFields = Pick<Pen, 'gh_repo' | 'gh_branch' | 'gh_path' | 'gh_commit_sha' | 'gh_commit_at' | 'gh_pages_url'>

interface Props {
  pen: Pen
  onClose: () => void
  onSaved: (patch: Partial<GhFields>) => void
}

type Phase = 'idle' | 'working' | 'done'
const NEW_BRANCH = '__new__'

export function GitHubPanel({ pen, onClose, onSaved }: Props) {
  const [account, setAccount] = useState<GitHubAccount | null | undefined>(undefined)
  const [editing, setEditing] = useState(!pen.gh_repo)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [repoName, setRepoName] = useState(slugRepoName(pen.title))
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)
  const [repo, setRepo] = useState('')
  const [branches, setBranches] = useState<string[] | null>(null)
  const [branch, setBranch] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [folder, setFolder] = useState(pen.gh_path ?? '')
  const [pages, setPages] = useState(!!pen.gh_pages_url)
  const [message, setMessage] = useState(`Actualiza ${pen.title}`)
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  async function loadAccount() {
    setAccount(await getAccount())
  }

  useEffect(() => {
    loadAccount()
    const onConnected = () => loadAccount()
    window.addEventListener('wakkpen:github', onConnected)
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => {
      window.removeEventListener('wakkpen:github', onConnected)
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    if (!account || !editing || mode !== 'existing' || repos) return
    listRepos(account.token)
      .then((r) => {
        setRepos(r)
        if (r[0]) setRepo(r[0].full_name)
      })
      .catch(handleError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, editing, mode])

  useEffect(() => {
    if (!account || !repo || mode !== 'existing') return
    setBranches(null)
    const info = repos?.find((r) => r.full_name === repo)
    listBranches(account.token, repo)
      .then((b) => {
        setBranches(b)
        setBranch(info && b.includes(info.default_branch) ? info.default_branch : b[0] ?? NEW_BRANCH)
      })
      .catch(handleError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, repo, mode])

  async function handleError(e: unknown) {
    if (e instanceof GitHubError && e.status === 401) {
      await disconnectGitHub()
      setAccount(null)
    }
    setError(e instanceof Error ? e.message : String(e))
    setPhase('idle')
  }

  async function connect() {
    setPhase('working')
    setError(null)
    try {
      await connectGitHub() // redirige a GitHub
    } catch (e) {
      handleError(e)
    }
  }

  async function run() {
    if (!account) return
    setPhase('working')
    setError(null)
    try {
      let target: { repo: string; branch: string; path: string }
      if (editing) {
        if (mode === 'new') {
          setStep('Creando repo')
          const created = await createRepo(account.token, repoName.trim(), `${pen.title} — hecho en Wakkpen`)
          target = { repo: created.full_name, branch: created.default_branch, path: folder }
        } else {
          const b = branch === NEW_BRANCH ? newBranch.trim() : branch
          if (!repo || !b) throw new Error('Elige repo y rama')
          target = { repo, branch: b, path: folder }
        }
      } else {
        target = { repo: pen.gh_repo!, branch: pen.gh_branch!, path: pen.gh_path ?? '' }
      }

      setStep('Subiendo archivos')
      const commit = await commitPen(account.token, pen, target, message.trim() || `Actualiza ${pen.title}`)

      let pagesUrl = pen.gh_pages_url
      if (pages) {
        setStep('Publicando en Pages')
        try {
          pagesUrl = await enablePages(account.token, target.repo, target.branch, target.path)
        } catch (e) {
          pagesUrl = null
          setError(
            `Commit hecho, pero no se pudo activar Pages (${e instanceof Error ? e.message : e}). Actívalo en el repo: Settings → Pages.`,
          )
        }
      }

      const patch: Partial<GhFields> = {
        gh_repo: target.repo,
        gh_branch: target.branch,
        gh_path: target.path,
        gh_commit_sha: commit.sha,
        gh_commit_at: new Date().toISOString(),
        gh_pages_url: pages ? pagesUrl : null,
      }
      const { error: dbErr } = await supabase.from('pens').update(patch).eq('id', pen.id)
      if (dbErr) throw dbErr
      onSaved(patch)
      setEditing(false)
      setPhase('done')
      setTimeout(() => setPhase((p) => (p === 'done' ? 'idle' : p)), 2500)
    } catch (e) {
      handleError(e)
    } finally {
      setStep('')
    }
  }

  const canRun =
    phase !== 'working' &&
    (!editing ||
      (mode === 'new' ? /^[A-Za-z0-9._-]+$/.test(repoName.trim()) : !!repo && (branch !== NEW_BRANCH || !!newBranch.trim())))

  return (
    <div className="drawer" role="dialog" aria-label="GitHub">
      <header className="drawer-header">
        <h2 className="gh-title">
          <GitHubMark />
          GitHub
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </header>

      {account === undefined ? (
        <div className="drawer-loading" />
      ) : account === null ? (
        <div className="gh-connect">
          <button className={`btn btn-primary btn-block${phase === 'working' ? ' is-busy' : ''}`} onClick={connect} disabled={phase === 'working'}>
            Conectar GitHub
          </button>
          <p className="hint">Solo repos públicos</p>
        </div>
      ) : (
        <div className="gh-body">
          <div className="gh-account">
            <span>@{account.login}</span>
            <button
              className="link-btn"
              onClick={async () => {
                await disconnectGitHub()
                setAccount(null)
              }}
            >
              Desconectar
            </button>
          </div>

          {editing ? (
            <>
              <div className="seg seg-block" role="tablist">
                <button role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'is-on' : ''} onClick={() => setMode('new')}>
                  Repo nuevo
                </button>
                <button
                  role="tab"
                  aria-selected={mode === 'existing'}
                  className={mode === 'existing' ? 'is-on' : ''}
                  onClick={() => setMode('existing')}
                >
                  Repo existente
                </button>
              </div>

              {mode === 'new' ? (
                <label className="field">
                  <span>Nombre</span>
                  <div className="input-prefix">
                    <em>{account.login}/</em>
                    <input value={repoName} onChange={(e) => setRepoName(e.target.value)} spellCheck={false} />
                  </div>
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>Repo</span>
                    <select className="select" value={repo} onChange={(e) => setRepo(e.target.value)} disabled={!repos}>
                      {!repos && <option>Cargando…</option>}
                      {repos?.map((r) => (
                        <option key={r.full_name} value={r.full_name} disabled={r.private}>
                          {r.full_name}
                          {r.private ? ' (privado)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Rama</span>
                    <select className="select" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!branches}>
                      {!branches && <option>Cargando…</option>}
                      {branches?.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                      {branches && <option value={NEW_BRANCH}>+ Nueva rama</option>}
                    </select>
                  </label>
                  {branch === NEW_BRANCH && (
                    <label className="field">
                      <span>Nueva rama</span>
                      <input className="input" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="ejercicio-1" spellCheck={false} />
                    </label>
                  )}
                </>
              )}

              <label className="field">
                <span>Carpeta</span>
                <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="raíz del repo" spellCheck={false} />
              </label>
            </>
          ) : (
            <div className="gh-target">
              <a href={`https://github.com/${pen.gh_repo}/tree/${pen.gh_branch}/${pen.gh_path ?? ''}`} target="_blank" rel="noreferrer">
                {pen.gh_repo}
              </a>
              <span className="gh-branch">{pen.gh_branch}{pen.gh_path ? ` / ${pen.gh_path}` : ''}</span>
              <button className="link-btn" onClick={() => setEditing(true)}>
                Cambiar
              </button>
            </div>
          )}

          <label className="check">
            <input type="checkbox" checked={pages} onChange={(e) => setPages(e.target.checked)} />
            Publicar en GitHub Pages
          </label>

          <label className="field">
            <span>Mensaje</span>
            <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>

          <button
            className={`btn btn-primary btn-block${phase === 'working' ? ' is-busy' : ''}${phase === 'done' ? ' is-success' : ''}`}
            onClick={run}
            disabled={!canRun}
          >
            {phase === 'working' ? step || 'Enviando' : phase === 'done' ? 'Hecho' : 'Commit'}
          </button>

          {(pen.gh_commit_sha || pen.gh_pages_url) && (
            <div className="gh-links">
              {pen.gh_commit_sha && (
                <a href={`https://github.com/${pen.gh_repo}/commit/${pen.gh_commit_sha}`} target="_blank" rel="noreferrer">
                  <code>{pen.gh_commit_sha.slice(0, 7)}</code>
                  {pen.gh_commit_at && <span>{timeAgo(pen.gh_commit_at, now)}</span>}
                </a>
              )}
              {pen.gh_pages_url && (
                <a href={pen.gh_pages_url} target="_blank" rel="noreferrer">
                  {pen.gh_pages_url.replace(/^https:\/\//, '')}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

export function GitHubMark({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
