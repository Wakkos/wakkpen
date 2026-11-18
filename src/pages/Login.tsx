import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    // El alta de correos que no son de ESAT la rechaza la base de datos.
    if (error) setError(/esat|database error|saving new user/i.test(error.message) ? 'Usa tu correo de ESAT (@esat.es o @esat-alumni.com)' : error.message)
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
        <h1>Wakkpen</h1>
        {step === 'email' ? (
          <form onSubmit={send}>
            <input
              type="email"
              required
              autoFocus
              placeholder="tu@esat.es"
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
