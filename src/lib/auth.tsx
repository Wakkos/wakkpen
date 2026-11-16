import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from './types'
import { storeProviderToken } from './github'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(s: Session | null) {
    if (!s) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile((data as Profile) ?? null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session?.provider_token) storeProviderToken(data.session.provider_token).then(() => window.dispatchEvent(new Event('wakkpen:github')))
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Fuera del callback para no bloquear el cliente de auth.
      setTimeout(() => {
        loadProfile(s)
        // Al volver de GitHub, el token del proveedor solo viene en esta sesión: se guarda.
        if (s?.provider_token) storeProviderToken(s.provider_token).then(() => window.dispatchEvent(new Event('wakkpen:github')))
      }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile: () => loadProfile(session) }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
