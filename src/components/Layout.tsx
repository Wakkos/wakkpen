import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

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

export function TopBar({ children }: { children?: ReactNode }) {
  const { profile } = useAuth()
  const teacher = profile?.role === 'teacher'
  return (
    <header className="topbar">
      <Logo />
      {teacher && (
        <nav className="topnav">
          <NavLink to="/profesor" end>
            En vivo
          </NavLink>
          <NavLink to="/profesor/muro">Muro</NavLink>
          <NavLink to="/profesor/alumnos">Alumnos</NavLink>
          <NavLink to="/pens">Mis pens</NavLink>
        </nav>
      )}
      <div className="topbar-slot">{children}</div>
      <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()} title={profile?.email}>
        Salir
      </button>
    </header>
  )
}

export function Page({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
  return (
    <div className="app">
      <TopBar>{bar}</TopBar>
      <main className="page">{children}</main>
    </div>
  )
}
