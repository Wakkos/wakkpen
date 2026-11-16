import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { PRESENCE_CHANNEL, type EditingPresence } from './presence'

export interface LiveInfo {
  open: boolean
  typing: boolean
}

// Presencia para el profesor: qué pens están abiertos y cuáles se están escribiendo.
export function useEditingPresence(): Record<string, LiveInfo> {
  const [state, setState] = useState<Record<string, EditingPresence[]>>({})
  const [, tick] = useState(0)

  useEffect(() => {
    const channel = supabase.channel(PRESENCE_CHANNEL)
    channel
      .on('presence', { event: 'sync' }, () => {
        setState(channel.presenceState<EditingPresence>() as Record<string, EditingPresence[]>)
      })
      .subscribe()
    const t = setInterval(() => tick((n) => n + 1), 2000)
    return () => {
      clearInterval(t)
      supabase.removeChannel(channel)
    }
  }, [])

  const now = Date.now()
  const byPen: Record<string, LiveInfo> = {}
  for (const metas of Object.values(state)) {
    for (const m of metas) {
      const prev = byPen[m.pen_id]
      const typing = now - (m.typing_at || 0) < 6000
      byPen[m.pen_id] = { open: true, typing: typing || !!prev?.typing }
    }
  }
  return byPen
}

export function useNow(interval = 15000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}
