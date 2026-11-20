import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import type { Pen, Profile } from './types'
import { ALL, useSessions } from './sessions'

// Datos del aula para el profe: perfiles (con la mano levantada) y pens completos, en vivo,
// filtrados por la sesión activa: sus alumnos y sus pens (los unidos a ella o sin sesión).
export function useClassroom() {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [pens, setPens] = useState<Pen[] | null>(null)
  const [flash, setFlash] = useState<Record<string, number>>({})

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => setProfiles(Object.fromEntries(((data as Profile[]) ?? []).map((p) => [p.id, p]))))
    supabase
      .from('pens')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data }) => setPens((data as Pen[]) ?? []))

    const ch = supabase
      .channel('classroom')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pens' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldId = (payload.old as { id?: string }).id
          setPens((prev) => prev?.filter((p) => p.id !== oldId) ?? prev)
          return
        }
        const row = payload.new as Pen
        setPens((prev) => [row, ...(prev ?? []).filter((p) => p.id !== row.id)])
        setFlash((f) => ({ ...f, [row.id]: Date.now() }))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        if (payload.eventType === 'DELETE') return
        const row = payload.new as Profile
        setProfiles((p) => ({ ...p, [row.id]: row }))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  const { activeId, inActive } = useSessions()
  const scoped = useMemo(() => {
    const prof = Object.fromEntries(Object.entries(profiles).filter(([, p]) => p.role === 'teacher' || inActive(p.id)))
    const list =
      pens?.filter((p) =>
        activeId === ALL ? inActive(p.owner_id) : p.session_id === activeId || (!p.session_id && inActive(p.owner_id)),
      ) ?? null
    return { profiles: prof, pens: list }
  }, [profiles, pens, activeId, inActive])

  async function lowerHand(userId: string) {
    setProfiles((p) => (p[userId] ? { ...p, [userId]: { ...p[userId], hand_raised_at: null } } : p))
    await supabase.rpc('lower_hand', { p_user: userId })
  }

  return { profiles: scoped.profiles, pens: scoped.pens, flash, lowerHand }
}

// Manos levantadas primero (por orden de llegada), luego por nombre.
export function byHandThenName(a?: Profile, b?: Profile): number {
  const ha = a?.hand_raised_at ?? ''
  const hb = b?.hand_raised_at ?? ''
  if (ha && hb) return ha.localeCompare(hb)
  if (ha) return -1
  if (hb) return 1
  return (a?.nombre ?? '').localeCompare(b?.nombre ?? '')
}
