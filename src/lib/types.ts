export type Role = 'student' | 'teacher'
export type CssLang = 'css' | 'scss'

export interface Profile {
  id: string
  email: string
  nombre: string
  role: Role
  created_at: string
}

export interface Pen {
  id: string
  owner_id: string
  title: string
  html: string
  css: string
  css_lang: CssLang
  js: string
  created_at: string
  updated_at: string
  gh_repo: string | null
  gh_branch: string | null
  gh_path: string
  gh_commit_sha: string | null
  gh_commit_at: string | null
  gh_pages_url: string | null
}

export interface PenWithOwner extends Pen {
  profiles: Pick<Profile, 'nombre' | 'email'> | null
}

export interface PenFile {
  id: string
  pen_id: string
  owner_id: string
  path: string
  name: string
  size: number
  mime: string
  created_at: string
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
