import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export interface Notification {
  id: string
  user_id: string
  kind: 'graded' | 'sheet' | 'solution' | 'notice'
  title: string
  link: string
  created_at: string
  read_at: string | null
}

interface Ctx {
  items: Notification[]
  unread: number
  ringing: boolean
  sound: boolean
  setSound: (v: boolean) => void
  markRead: (id: string) => void
  markAll: () => void
}

const NotificationsContext = createContext<Ctx | null>(null)
const SOUND_KEY = 'wakkpen.notif.sound'

// Dos notas cortas y suaves con Web Audio: no hace falta ningún archivo.
let audio: AudioContext | null = null
export function chime() {
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = t + i * 0.12
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35)
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(start + 0.4)
    }
  } catch {
    /* sin audio disponible */
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const uid = session?.user.id
  const [items, setItems] = useState<Notification[]>([])
  const [ringing, setRinging] = useState(false)
  const [sound, setSoundState] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const soundRef = useRef(sound)
  soundRef.current = sound

  const setSound = useCallback((v: boolean) => {
    setSoundState(v)
    try {
      localStorage.setItem(SOUND_KEY, v ? 'on' : 'off')
    } catch {
      /* almacenamiento no disponible */
    }
    if (v) chime()
  }, [])

  useEffect(() => {
    if (!uid) return
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(40)
      .then(({ data }) => setItems((data as Notification[]) ?? []))

    let timer: ReturnType<typeof setTimeout>
    const ch = supabase
      .channel(`notif-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (p) => {
        const row = p.new as Notification
        setItems((list) => [row, ...list.filter((n) => n.id !== row.id)].slice(0, 40))
        if (soundRef.current) chime()
        setRinging(true)
        clearTimeout(timer)
        timer = setTimeout(() => setRinging(false), 1200)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (p) => {
        const row = p.new as Notification
        setItems((list) => [row, ...list.filter((n) => n.id !== row.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)))
      })
      .subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(ch)
    }
  }, [uid])

  const markRead = useCallback((id: string) => {
    const now = new Date().toISOString()
    setItems((list) => list.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)))
    supabase.from('notifications').update({ read_at: now }).eq('id', id).is('read_at', null).then()
  }, [])

  const markAll = useCallback(() => {
    if (!uid) return
    const now = new Date().toISOString()
    setItems((list) => list.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    supabase.from('notifications').update({ read_at: now }).eq('user_id', uid).is('read_at', null).then()
  }, [uid])

  const unread = items.filter((n) => !n.read_at).length

  return (
    <NotificationsContext.Provider value={{ items, unread, ringing, sound, setSound, markRead, markAll }}>{children}</NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications fuera de NotificationsProvider')
  return ctx
}
