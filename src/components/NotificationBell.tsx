import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useNotifications, type Notification } from '../lib/notifications'
import { timeAgo } from '../lib/export'

const isExternal = (link: string) => /^https?:\/\//i.test(link)

export function NotificationBell() {
  const { profile } = useAuth()
  const teacher = profile?.role === 'teacher'
  const { items, unread, ringing, sound, setSound, markRead, markAll } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function openItem(n: Notification) {
    markRead(n.id)
    if (!n.link) return
    setOpen(false)
    if (isExternal(n.link)) window.open(n.link, '_blank', 'noopener')
    else navigate(n.link)
  }

  return (
    <div className="notif" ref={ref}>
      <button
        className={`notif-btn${open ? ' is-open' : ''}${ringing ? ' is-ringing' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notificaciones: ${unread} sin leer` : 'Notificaciones'}
        aria-expanded={open}
      >
        <BellIcon />
        {unread > 0 && (
          <span key={unread} className="notif-badge">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notificaciones">
          <header className="notif-head">
            <strong>Notificaciones</strong>
            <button className={`notif-sound${sound ? ' is-on' : ''}`} onClick={() => setSound(!sound)} aria-pressed={sound} title={sound ? 'Silenciar' : 'Activar sonido'}>
              <SoundIcon on={sound} />
            </button>
            {unread > 0 && (
              <button className="link-btn" onClick={markAll}>
                Marcar leídas
              </button>
            )}
          </header>
          {teacher && <NoticeForm />}
          {items.length === 0 ? (
            !teacher && <p className="notif-empty">Nada por ahora.</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`notif-item k-${n.kind}${n.read_at ? '' : ' is-unread'}`} onClick={() => openItem(n)}>
                    <span className="notif-dot" />
                    <span className="notif-title">{n.title}</span>
                    <span className="notif-time">{timeAgo(n.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// El profe envía un aviso a todos los alumnos, con un enlace opcional.
function NoticeForm() {
  const [title, setTitle] = useState('')
  const [link, setLink] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setState('sending')
    let target = link.trim()
    // Un enlace de la propia app se guarda como ruta para abrirlo sin recargar.
    if (target.startsWith(location.origin)) target = target.slice(location.origin.length) || '/'
    const { data, error: err } = await supabase.rpc('send_notice', { p_title: title, p_link: target })
    if (err) {
      setState('error')
      setError(err.message)
      return
    }
    setTitle('')
    setLink('')
    setState('sent')
    setError(`Enviado a ${data} alumnos`)
    setTimeout(() => setState('idle'), 2500)
  }

  return (
    <form className="notice-form" onSubmit={send}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Aviso para la clase" maxLength={300} />
      <div className="notice-row">
        <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Enlace (opcional)" />
        <button className={`btn btn-primary btn-sm${state === 'sending' ? ' is-busy' : ''}`} disabled={!title.trim() || state === 'sending'}>
          Enviar
        </button>
      </div>
      {(state === 'sent' || state === 'error') && <p className={state === 'error' ? 'form-error' : 'notice-sent'}>{error}</p>}
    </form>
  )
}

function BellIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
    </svg>
  )
}
