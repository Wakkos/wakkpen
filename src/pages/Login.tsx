import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  /** Título de la sesión a la que se entra por enlace. */
  heading?: string
  /** La sesión admite correos de fuera de ESAT. */
  guests?: boolean
  /** Antes de pedir el código (p. ej. autorizar un invitado). */
  beforeSend?: (email: string) => Promise<boolean>
}

export function Login({ heading, guests, beforeSend }: Props = {}) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    if (beforeSend) await beforeSend(email.trim())
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    // El alta de correos que no son de ESAT la rechaza la base de datos.
    if (error)
      setError(
        /esat|database error|saving new user/i.test(error.message) && !guests ? 'Usa tu correo de ESAT (@esat.es o @esat-alumni.com)' : error.message,
      )
    else setStep('code')
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError('Código no válido o caducado')
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo" aria-hidden>
          <svg viewBox="0 0 32 32" width="40" height="40">
            <path d="M11 10l-6 6 6 6M21 10l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1>{heading ?? 'Wakkpen'}</h1>
        {heading && <p className="muted login-sub">Entra para unirte a la sesión</p>}
        {step === 'email' ? (
          <form onSubmit={send}>
            <input
              type="email"
              required
              autoFocus
              placeholder={guests ? 'tu@email.com' : 'tu@esat.es'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} disabled={busy}>
              {busy ? 'Enviando' : 'Entrar'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p className="login-sent">
              Enlace enviado a <strong>{email}</strong>. Ábrelo o escribe el código.
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="Código"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="code-input"
            />
            <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} disabled={busy || code.trim().length < 6}>
              {busy ? 'Comprobando' : 'Continuar'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep('email')}>
              Usar otro email
            </button>
          </form>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  )
}
