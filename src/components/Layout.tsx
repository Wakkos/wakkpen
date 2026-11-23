import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { NotificationBell } from './NotificationBell'
import { SessionSwitcher } from '../lib/sessions'
import { useThemePref, type ThemePref } from '../lib/theme'

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Wakkpen">
      <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
        <path d="M11 10l-6 6 6 6M21 10l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Wakkpen</span>
    </Link>
  )
}

function UserMenu() {
  const { profile, session } = useAuth()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  const name = profile?.nombre || session?.user.email || ''
  const teacher = profile?.role === 'teacher'

  async function signOut() {
    setLeaving(true)
    await supabase.auth.signOut()
  }

  return (
    <div className="user-menu" ref={ref}>
      <button className={`avatar${open ? ' is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={name}>
        {name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="user-pop" role="menu">
          <div className="user-info">
            <strong>{profile?.nombre}</strong>
            <span>{session?.user.email}</span>
            <span className={`tag${teacher ? '' : ' tag-muted'}`}>{teacher ? 'Profesor' : 'Alumno'}</span>
          </div>
          <Link to="/pens" role="menuitem" onClick={() => setOpen(false)}>
            Mis pens
          </Link>
          <Link to="/ejercicios" role="menuitem" onClick={() => setOpen(false)}>
            Ejercicios
          </Link>
          {teacher && (
            <Link to="/profesor/claude" role="menuitem" onClick={() => setOpen(false)}>
              Conectar con Claude
            </Link>
          )}
          <ThemeSwitch />
          <button role="menuitem" className={`user-signout${leaving ? ' is-busy' : ''}`} onClick={signOut} disabled={leaving}>
            Desconectar
          </button>
        </div>
      )}
    </div>
  )
}

export function TopBar({ children }: { children?: ReactNode }) {
  const { profile } = useAuth()
  const teacher = profile?.role === 'teacher'
  return (
    <header className="topbar">
      <Logo />
      <nav className="topnav">
        {teacher ? (
          <>
            <NavLink to="/profesor/sesiones">Sesiones</NavLink>
            <NavLink to="/profesor" end>
              En vivo
            </NavLink>
            <NavLink to="/profesor/muro">Muro</NavLink>
            <NavLink to="/profesor/ejercicios">Ejercicios</NavLink>
            <NavLink to="/profesor/alumnos">Alumnos</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/pens">Mis pens</NavLink>
            <NavLink to="/ejercicios">Ejercicios</NavLink>
            <NavLink to="/sesiones">Sesiones</NavLink>
          </>
        )}
      </nav>
      {teacher && <SessionSwitcher />}
      <div className="topbar-slot">{children}</div>
      <NotificationBell />
      <UserMenu />
    </header>
  )
}

export function Page({ children, bar, wide }: { children: ReactNode; bar?: ReactNode; wide?: boolean }) {
  return (
    <div className="app">
      <TopBar>{bar}</TopBar>
      <main className={`page${wide ? ' page-wide' : ''}`}>{children}</main>
    </div>
  )
}

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
]

function ThemeSwitch() {
  const [pref, setPref] = useThemePref()
  return (
    <div className="theme-switch" role="group" aria-label="Tema">
      <span>Tema</span>
      <div className="seg">
        {THEMES.map((t) => (
          <button key={t.value} className={pref === t.value ? 'is-on' : ''} onClick={() => setPref(t.value)} aria-pressed={pref === t.value}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
