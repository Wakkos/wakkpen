import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export interface ClassSession {
  id: string
  code: string
  title: string
  owner_id: string
  is_open: boolean
  guests_allowed: boolean
  archived: boolean
  created_at: string
}

interface Membership {
  session_id: string
  user_id: string
}

export const ALL = 'all'

interface Ctx {
  sessions: ClassSession[]
  loaded: boolean
  /** Profe: sesión que filtra En vivo, Muro y Alumnos ('all' = todas las mías). */
  activeId: string
  setActiveId: (id: string) => void
  active: ClassSession | null
  /** Alumnos de cada sesión (el profe ve los de las suyas; el alumno, solo él). */
  members: Record<string, Set<string>>
  /** ¿El usuario está en la sesión activa (o en alguna, si es 'all')? */
  inActive: (userId: string) => boolean
  refresh: () => Promise<void>
}

const SessionsContext = createContext<Ctx | null>(null)

export const sessionLink = (code: string) => `${location.origin}/s/${code}`

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const uid = session?.user.id
  const teacher = profile?.role === 'teacher'
  const key = `wakkpen.session.${uid}`
  const [sessions, setSessions] = useState<ClassSession[]>([])
  const [rows, setRows] = useState<Membership[]>([])
  const [loaded, setLoaded] = useState(false)
  const [activeId, setActive] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })

  const refresh = useCallback(async () => {
    if (!uid) return
    const [{ data: s }, { data: m }] = await Promise.all([
      supabase.from('sessions').select('*').order('created_at', { ascending: false }),
      supabase.from('session_members').select('session_id, user_id'),
    ])
    setSessions((s as ClassSession[]) ?? [])
    setRows((m as Membership[]) ?? [])
    setLoaded(true)
  }, [uid])

  useEffect(() => {
    if (!uid) return
    refresh()
    const ch = supabase
      .channel(`sessions-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_members' }, () => refresh())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [uid, refresh])

  const setActiveId = useCallback(
    (id: string) => {
      setActive(id)
      try {
        localStorage.setItem(key, id)
      } catch {
        /* sin almacenamiento */
      }
    },
    [key],
  )

  const live = sessions.filter((s) => !s.archived)
  // Si la guardada ya no existe, la primera sin archivar.
  const resolved = activeId === ALL || sessions.some((s) => s.id === activeId) ? activeId : (live[0]?.id ?? ALL)
  const active = sessions.find((s) => s.id === resolved) ?? null

  const members = useMemo(() => {
    const out: Record<string, Set<string>> = {}
    for (const r of rows) (out[r.session_id] ??= new Set()).add(r.user_id)
    return out
  }, [rows])

  const inActive = useCallback(
    (userId: string) => (resolved === ALL ? rows.some((r) => r.user_id === userId) : !!members[resolved]?.has(userId)),
    [resolved, rows, members],
  )

  return (
    <SessionsContext.Provider
      value={{ sessions, loaded, activeId: teacher ? resolved : ALL, setActiveId, active: teacher ? active : null, members, inActive, refresh }}
    >
      {children}
    </SessionsContext.Provider>
  )
}

export function useSessions() {
  const ctx = useContext(SessionsContext)
  if (!ctx) throw new Error('useSessions fuera de SessionsProvider')
  return ctx
}

export function SessionSwitcher() {
  const { sessions, activeId, setActiveId } = useSessions()
  const live = sessions.filter((s) => !s.archived)
  if (!live.length) return null
  return (
    <select className="select select-sm session-switch" value={activeId} onChange={(e) => setActiveId(e.target.value)} aria-label="Sesión activa">
      {live.map((s) => (
        <option key={s.id} value={s.id}>
          {s.title}
        </option>
      ))}
      <option value={ALL}>Todas mis sesiones</option>
    </select>
  )
}
