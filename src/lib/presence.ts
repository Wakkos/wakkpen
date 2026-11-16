import { supabase } from './supabase'

// Un canal común de presencia. Cada alumno anuncia solo el id del pen que tiene abierto.
export const PRESENCE_CHANNEL = 'wakkpen-editing'

export interface EditingPresence {
  pen_id: string
  typing_at: number
}

export function joinEditing(userId: string, penId: string) {
  const channel = supabase.channel(PRESENCE_CHANNEL, { config: { presence: { key: userId } } })
  let subscribed = false
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      subscribed = true
      channel.track({ pen_id: penId, typing_at: 0 } satisfies EditingPresence)
    }
  })
  return {
    typing() {
      if (subscribed) channel.track({ pen_id: penId, typing_at: Date.now() } satisfies EditingPresence)
    },
    leave() {
      supabase.removeChannel(channel)
    },
  }
}
