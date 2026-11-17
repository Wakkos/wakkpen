import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Pen } from '../lib/types'
import { popoutChannel, type LivePayload } from '../lib/live'
import { Preview } from '../components/Preview'

// Vista previa en una ventana aparte (otro monitor). Recibe los cambios del editor por BroadcastChannel.
export function Popout() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<LivePayload | null>(null)

  useEffect(() => {
    if (!id) return
    supabase
      .from('pens')
      .select('title, html, css, css_lang, js, libs')
      .eq('id', id)
      .maybeSingle()
      .then(({ data: p }) => p && setData((cur) => cur ?? (p as Pen)))
    const ch = popoutChannel(id)
    ch.onmessage = (e) => {
      if (e.data && typeof e.data === 'object') setData(e.data as LivePayload)
    }
    ch.postMessage('hello')
    return () => ch.close()
  }, [id])

  useEffect(() => {
    if (data?.title) document.title = `${data.title} · Wakkpen`
  }, [data?.title])

  if (!data) return <div className="app-loading" />
  return (
    <div className="popout">
      <Preview html={data.html} css={data.css} cssLang={data.css_lang} js={data.js} libs={data.libs} delay={150} />
    </div>
  )
}
