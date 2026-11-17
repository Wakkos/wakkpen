import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// Botón de levantar la mano. Se sincroniza en vivo: si el profe la baja, se baja aquí.
export function HandButton() {
  const { session, profile } = useAuth()
  const [raised, setRaised] = useState<boolean>(!!profile?.hand_raised_at)
  const [busy, setBusy] = useState(false)
  const uid = session?.user.id

  useEffect(() => setRaised(!!profile?.hand_raised_at), [profile?.hand_raised_at])

  useEffect(() => {
    if (!uid) return
    const ch = supabase
      .channel(`hand-${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, (p) =>
        setRaised(!!(p.new as { hand_raised_at: string | null }).hand_raised_at),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [uid])

  if (!uid || profile?.role === 'teacher') return null

  async function toggle() {
    setBusy(true)
    const next = !raised
    setRaised(next)
    const { error } = await supabase
      .from('profiles')
      .update({ hand_raised_at: next ? new Date().toISOString() : null })
      .eq('id', uid!)
    if (error) setRaised(!next)
    setBusy(false)
  }

  return (
    <button
      className={`hand-btn${raised ? ' is-raised' : ''}`}
      onClick={toggle}
      disabled={busy}
      title={raised ? 'Bajar la mano' : 'Levantar la mano'}
      aria-pressed={raised}
    >
      <span aria-hidden>✋</span>
    </button>
  )
}
