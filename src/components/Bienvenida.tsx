import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'

// Huevo de pascua: solo para una cuenta concreta (se compara la huella del correo, no el correo).
const TARGET = '4f95baecf17397b6bf4dfaba76b84ada67c6279d0a786ea00fdf23b7618c4d67'
const SEEN_KEY = 'wakkpen.bienvenida'

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim().toLowerCase()))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function Bienvenida() {
  const { session, profile } = useAuth()
  const email = session?.user.email ?? ''
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!email) return
    try {
      if (localStorage.getItem(SEEN_KEY)) return
    } catch {
      /* sin almacenamiento: se enseña igual */
    }
    sha256(email).then((h) => h === TARGET && setShow(true))
  }, [email])

  if (!show) return null

  function close() {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* da igual */
    }
    setShow(false)
  }

  const name = (profile?.nombre || 'JM').toUpperCase()

  return (
    <div className="bv" role="dialog" aria-label="Bienvenida">
      <div className="bv-stars" aria-hidden>
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, animationDelay: `${(i % 7) * 0.2}s` }}>
            ✦
          </span>
        ))}
      </div>
      <div className="bv-marquee" aria-hidden>
        <span>★ BIENVENIDO A WAKKPEN ★ EL MEJOR PROFE DE ESAT ★ MODA DE TEMPORADA ★ BIENVENIDO A WAKKPEN ★ EL MEJOR PROFE DE ESAT ★ MODA DE TEMPORADA ★</span>
      </div>
      <h1 className="bv-title">¡¡¡BIENVENIDO {name}!!!</h1>
      <div className="bv-frame">
        <img src="/x/7f3a.png" alt="" />
        <span className="bv-new">NEW!</span>
      </div>
      <p className="bv-sub">Esta web se ve mejor a 800×600 con Internet Explorer 6</p>
      <p className="bv-counter">
        Eres el visitante nº <b>000001</b>
      </p>
      <button className="bv-btn" onClick={close}>
        ENTRAR (si te atreves)
      </button>
    </div>
  )
}
