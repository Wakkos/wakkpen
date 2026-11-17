import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { liveUrl } from '../lib/live'

interface Props {
  penId: string
  token: string
  viewers: number
  onToken: (token: string) => void
  onClose: () => void
}

export function QrPanel({ penId, token, viewers, onToken, onClose }: Props) {
  const [img, setImg] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const url = liveUrl(token)

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#0f1115', light: '#ffffff' } }).then(setImg)
  }, [url])

  async function regenerate() {
    if (!confirm('El enlace actual dejará de funcionar. ¿Generar uno nuevo?')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('regenerate_live_token', { p_pen: penId })
    setBusy(false)
    if (!error && data) onToken(data as string)
  }

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="drawer" role="dialog" aria-label="Ver en el móvil">
      <header className="drawer-header">
        <h2>En el móvil</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </header>
      <div className="qr">{img && <img src={img} alt="QR del pen" />}</div>
      <div className="qr-status">
        <span className={`live-dot${viewers > 0 ? ' is-active' : ''}`} />
        {viewers > 0 ? `${viewers} conectado${viewers > 1 ? 's' : ''}` : 'Escanea con la cámara'}
      </div>
      <div className="qr-actions">
        <button className={`btn btn-ghost btn-sm${copied ? ' is-done' : ''}`} onClick={copy}>
          {copied ? 'Copiado' : 'Copiar enlace'}
        </button>
        <button className={`btn btn-ghost btn-sm${busy ? ' is-busy' : ''}`} onClick={regenerate} disabled={busy}>
          Nuevo enlace
        </button>
      </div>
    </div>
  )
}
