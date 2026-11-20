import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Login } from './Login'

interface Preview {
  title: string
  is_open: boolean
  guests_allowed: boolean
}

const JOIN_KEY = 'wakkpen.join'

function rememberJoin(code: string | null) {
  try {
    if (code) localStorage.setItem(JOIN_KEY, code)
    else localStorage.removeItem(JOIN_KEY)
  } catch {
    /* sin almacenamiento */
  }
}

// Tras entrar desde el correo: si había un enlace de sesión pendiente, se retoma.
export function PendingJoin() {
  const navigate = useNavigate()
  useEffect(() => {
    let code: string | null = null
    try {
      code = localStorage.getItem(JOIN_KEY)
    } catch {
      /* sin almacenamiento */
    }
    if (code) navigate(`/s/${code}`, { replace: true })
  }, [navigate])
  return null
}

// Enlace de sesión: /s/CODIGO. Sin cuenta, enseña la sesión y el acceso; con cuenta, une y entra.
export function Join() {
  const { code = '' } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { session, profile, loading } = useAuth()
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('session_preview', { p_code: code }).then(({ data }) => setPreview(((data as Preview[]) ?? [])[0] ?? null))
  }, [code])

  // Si entra por el enlace del correo, vuelve a la raíz: se recuerda el código para terminar de unirse.
  useEffect(() => {
    if (!session) rememberJoin(code)
  }, [session, code])

  useEffect(() => {
    if (!session || !profile) return
    supabase.rpc('join_session', { p_code: code }).then(({ data, error: err }) => {
      rememberJoin(null)
      if (err) return setError(err.message)
      navigate(profile.role === 'teacher' ? `/profesor/sesiones/${data}` : `/sesion/${data}`, { replace: true })
    })
  }, [session, profile, code, navigate])

  if (loading || preview === undefined || (session && !profile && !error)) return <div className="app-loading" />

  if (!preview)
    return (
      <div className="login">
        <div className="login-card">
          <h1>Sesión no encontrada</h1>
          <p className="muted">Revisa el enlace o el código.</p>
          <Link to="/">Ir a Wakkpen</Link>
        </div>
      </div>
    )

  if (session)
    return (
      <div className="login">
        <div className="login-card">
          <h1>{preview.title}</h1>
          {error ? <p className="form-error">{error}</p> : <p className="muted">Entrando…</p>}
          <Link to="/">Ir a Wakkpen</Link>
        </div>
      </div>
    )

  if (!preview.is_open)
    return (
      <div className="login">
        <div className="login-card">
          <h1>{preview.title}</h1>
          <p className="muted">Esta sesión ya no admite gente nueva.</p>
        </div>
      </div>
    )

  return (
    <Login
      heading={preview.title}
      guests={preview.guests_allowed}
      // Correos de fuera de ESAT: se autorizan para esta sesión antes de pedir el código.
      beforeSend={preview.guests_allowed ? async (email) => (await supabase.rpc('request_guest_access', { p_code: code, p_email: email })).data === true : undefined}
    />
  )
}
