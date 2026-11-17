import { supabase } from './supabase'
import type { CssLang } from './types'

export interface LivePayload {
  title: string
  html: string
  css: string
  css_lang: CssLang
  js: string
  libs: string[]
}

// Envío en vivo al móvil (QR): canal de broadcast público por token secreto del pen.
// Solo se envía si hay algún móvil conectado, para no gastar mensajes de Realtime.
export function liveSender(token: string) {
  const channel = supabase.channel(`live:${token}`, {
    config: { broadcast: { self: false }, presence: { key: 'editor' } },
  })
  let ready = false
  let viewers = 0
  let last: LivePayload | null = null

  const send = (p: LivePayload) => channel.send({ type: 'broadcast', event: 'pen', payload: p })

  channel
    .on('presence', { event: 'sync' }, () => {
      viewers = Object.keys(channel.presenceState()).filter((k) => k !== 'editor').length
    })
    .on('broadcast', { event: 'hello' }, () => {
      if (last) send(last)
    })
    .subscribe((status) => {
      ready = status === 'SUBSCRIBED'
    })

  return {
    update(p: LivePayload) {
      last = p
      if (ready && viewers > 0) send(p)
    },
    viewers: () => viewers,
    leave() {
      supabase.removeChannel(channel)
    },
  }
}

// Ventana aparte en el mismo navegador: BroadcastChannel, sin pasar por el servidor.
export function popoutChannel(penId: string) {
  return new BroadcastChannel(`wakkpen:${penId}`)
}

export function liveUrl(token: string) {
  return `${window.location.origin}/live/${token}`
}
