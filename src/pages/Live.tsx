import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { LivePayload } from '../lib/live'
import { Preview } from '../components/Preview'

// Vista en el móvil por QR: sin login. Carga el pen con su token secreto y escucha los cambios en vivo.
export function Live() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<LivePayload | null>(null)
  const [missing, setMissing] = useState(false)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return setMissing(true)
    supabase.rpc('get_live_pen', { p_token: token }).then(({ data: rows }) => {
      const row = (rows as LivePayload[] | null)?.[0]
      if (!row) setMissing(true)
      else setData((cur) => cur ?? row)
    })
    const ch = supabase.channel(`live:${token}`, { config: { presence: { key: crypto.randomUUID() } } })
    ch.on('broadcast', { event: 'pen' }, ({ payload }) => setData(payload as LivePayload)).subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnected(true)
        ch.track({ at: Date.now() })
        ch.send({ type: 'broadcast', event: 'hello', payload: {} })
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnected(false)
    })
    return () => {
      supabase.removeChannel(ch)
    }
  }, [token])

  useEffect(() => {
    if (data?.title) document.title = data.title
  }, [data?.title])

  if (missing) return <div className="live-missing">Este enlace ya no funciona.</div>
  if (!data) return <div className="app-loading" />
  return (
    <div className="live-view">
      <Preview html={data.html} css={data.css} cssLang={data.css_lang} js={data.js} libs={data.libs} delay={150} bare />
      <span className={`live-badge${connected ? ' is-on' : ''}`} aria-hidden />
    </div>
  )
}
