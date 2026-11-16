import { supabase } from './supabase'
import type { Pen } from './types'
import { compileStyles } from './scss'
import { buildExportDoc } from './preview'
import { listFiles, publicUrl } from './files'

// Integración con GitHub desde el navegador (api.github.com admite CORS).
// El token sale del login OAuth de Supabase con scope public_repo y se guarda en github_tokens,
// una tabla que solo puede leer su dueño.

export const GH_SCOPES = 'public_repo'
const API = 'https://api.github.com'

export class GitHubError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface GitHubAccount {
  login: string
  token: string
}

export interface RepoInfo {
  full_name: string
  default_branch: string
  private: boolean
  html_url: string
}

// ---------- Conexión ----------

export async function getAccount(): Promise<GitHubAccount | null> {
  const { data } = await supabase.from('github_tokens').select('login, token').maybeSingle()
  return (data as GitHubAccount) ?? null
}

export async function connectGitHub(): Promise<void> {
  const { data } = await supabase.auth.getUser()
  const linked = data.user?.identities?.some((i) => i.provider === 'github')
  const opts = { scopes: GH_SCOPES, redirectTo: window.location.href }
  // Si ya está vinculado, se vuelve a autorizar con signIn (mismo usuario) para obtener un token nuevo.
  const { error } = linked
    ? await supabase.auth.signInWithOAuth({ provider: 'github', options: opts })
    : await supabase.auth.linkIdentity({ provider: 'github', options: opts })
  if (error) throw error
}

// Se llama tras volver de GitHub: el provider_token solo viene en la sesión en ese momento.
export async function storeProviderToken(token: string): Promise<void> {
  const res = await fetch(`${API}/user`, { headers: ghHeaders(token) })
  if (!res.ok) return
  const user = (await res.json()) as { login: string }
  const scopes = res.headers.get('x-oauth-scopes') ?? ''
  await supabase.from('github_tokens').upsert({ login: user.login, token, scopes })
}

export async function disconnectGitHub(): Promise<void> {
  const { data } = await supabase.auth.getUser()
  if (data.user) await supabase.from('github_tokens').delete().eq('user_id', data.user.id)
}

// ---------- API ----------

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...ghHeaders(token), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (body as { message?: string }).message ?? res.statusText
    if (res.status === 401) throw new GitHubError('La conexión con GitHub ha caducado. Vuelve a conectar.', 401)
    throw new GitHubError(msg, res.status)
  }
  return body as T
}

export function listRepos(token: string): Promise<RepoInfo[]> {
  return gh<RepoInfo[]>(token, '/user/repos?per_page=100&sort=updated&affiliation=owner')
}

export async function listBranches(token: string, repo: string): Promise<string[]> {
  try {
    const b = await gh<{ name: string }[]>(token, `/repos/${repo}/branches?per_page=100`)
    return b.map((x) => x.name)
  } catch (e) {
    if (e instanceof GitHubError && e.status === 409) return [] // repo vacío
    throw e
  }
}

export function getRepo(token: string, repo: string): Promise<RepoInfo> {
  return gh<RepoInfo>(token, `/repos/${repo}`)
}

export async function createRepo(token: string, name: string, description: string): Promise<RepoInfo> {
  const repo = await gh<RepoInfo>(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name, description, auto_init: true, private: false }),
  })
  // GitHub tarda un momento en crear el commit inicial de auto_init: se espera a que exista la rama.
  for (let i = 0; i < 8; i++) {
    if (await headSha(token, repo.full_name, repo.default_branch)) break
    await new Promise((r) => setTimeout(r, 750))
  }
  return repo
}

async function headSha(token: string, repo: string, branch: string): Promise<string | null> {
  try {
    const ref = await gh<{ object: { sha: string } }>(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)
    return ref.object.sha
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null
    throw e
  }
}

// Repo vacío: se crea un README con la API de contenidos para que exista la rama por defecto.
async function initEmptyRepo(token: string, repo: RepoInfo): Promise<void> {
  await gh(token, `/repos/${repo.full_name}/contents/README.md`, {
    method: 'PUT',
    body: JSON.stringify({ message: 'Inicializa el repo', content: b64(`# ${repo.full_name.split('/')[1]}\n`), branch: repo.default_branch }),
  })
}

export async function ensureBranch(token: string, repo: string, branch: string): Promise<void> {
  if (await headSha(token, repo, branch)) return
  const info = await getRepo(token, repo)
  let base = await headSha(token, repo, info.default_branch)
  if (!base) {
    await initEmptyRepo(token, info)
    base = await headSha(token, repo, info.default_branch)
  }
  if (!base) throw new GitHubError('No se pudo preparar la rama base del repo', 409)
  if (branch === info.default_branch) return
  await gh(token, `/repos/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base }),
  })
}

// ---------- Contenido del commit ----------

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Las URLs de los archivos subidos pasan a rutas relativas (assets/...), así el repo funciona solo.
export function relativizeAssets(code: string, pen: Pick<Pen, 'id' | 'owner_id'>): string {
  const prefix = publicUrl(`${pen.owner_id}/${pen.id}/`)
  return code.replace(new RegExp(escapeRegex(prefix), 'g'), 'assets/')
}

interface FileEntry {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
}

export async function buildPenFiles(pen: Pen): Promise<FileEntry[]> {
  const html = relativizeAssets(pen.html, pen)
  const src = relativizeAssets(pen.css, pen)
  const js = relativizeAssets(pen.js, pen)
  const { css, error } = await compileStyles(src, pen.css_lang)
  if (error) throw new Error(`No se puede hacer commit con errores de SCSS: ${error}`)

  const files: FileEntry[] = [
    { path: 'index.html', content: buildExportDoc(html, pen.title), encoding: 'utf-8' },
    { path: 'style.css', content: css, encoding: 'utf-8' },
    { path: 'script.js', content: js, encoding: 'utf-8' },
  ]
  if (pen.css_lang === 'scss') files.push({ path: 'style.scss', content: src, encoding: 'utf-8' })

  for (const f of await listFiles(pen.id)) {
    const res = await fetch(publicUrl(f.path))
    if (res.ok) files.push({ path: `assets/${f.name}`, content: await blobToBase64(await res.blob()), encoding: 'base64' })
  }
  return files
}

function cleanPath(p: string): string {
  return p
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/')
}

// ---------- Commit ----------

export interface CommitResult {
  sha: string
  url: string
}

export async function commitPen(
  token: string,
  pen: Pen,
  target: { repo: string; branch: string; path: string },
  message: string,
): Promise<CommitResult> {
  const { repo, branch } = target
  const base = cleanPath(target.path)
  await ensureBranch(token, repo, branch)

  const parent = await headSha(token, repo, branch)
  if (!parent) throw new GitHubError('La rama no existe', 404)
  const parentCommit = await gh<{ tree: { sha: string } }>(token, `/repos/${repo}/git/commits/${parent}`)

  const files = await buildPenFiles(pen)
  const tree = []
  for (const f of files) {
    const blob = await gh<{ sha: string }>(token, `/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: f.content, encoding: f.encoding }),
    })
    tree.push({ path: base ? `${base}/${f.path}` : f.path, mode: '100644', type: 'blob', sha: blob.sha })
  }

  const newTree = await gh<{ sha: string }>(token, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree }),
  })
  const commit = await gh<{ sha: string; html_url: string }>(token, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parent] }),
  })
  await gh(token, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  })
  return { sha: commit.sha, url: `https://github.com/${repo}/commit/${commit.sha}` }
}

// ---------- GitHub Pages ----------

export async function enablePages(token: string, repo: string, branch: string, path: string): Promise<string> {
  let pages: { html_url: string; source?: { branch: string } } | null = null
  try {
    pages = await gh(token, `/repos/${repo}/pages`)
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) throw e
  }
  if (!pages) {
    pages = await gh(token, `/repos/${repo}/pages`, {
      method: 'POST',
      body: JSON.stringify({ source: { branch, path: '/' } }),
    })
  } else if (pages.source?.branch !== branch) {
    await gh(token, `/repos/${repo}/pages`, {
      method: 'PUT',
      body: JSON.stringify({ source: { branch, path: '/' } }),
    })
  }
  const root = (pages?.html_url ?? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/`).replace(/\/?$/, '/')
  const sub = cleanPath(path)
  return sub ? `${root}${sub}/` : root
}

export function slugRepoName(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'mi-pen'
  )
}

