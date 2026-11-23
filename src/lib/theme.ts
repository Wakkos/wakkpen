import { useEffect, useState } from 'react'

// Tema: sigue al sistema por defecto; el usuario puede forzar claro u oscuro (se guarda en este navegador).
export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'wakkpen.theme'
const EVENT = 'wakkpen:theme'
const lightQuery = () => window.matchMedia('(prefers-color-scheme: light)')

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const el = document.documentElement
  if (pref === 'system') delete el.dataset.theme
  else el.dataset.theme = pref
  window.dispatchEvent(new Event(EVENT))
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* sin almacenamiento */
  }
  applyTheme(pref)
}

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme
  if (t) return t === 'dark'
  return !lightQuery().matches
}

export function useIsDark(): boolean {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const update = () => setDark(isDark())
    const mq = lightQuery()
    mq.addEventListener('change', update)
    window.addEventListener(EVENT, update)
    return () => {
      mq.removeEventListener('change', update)
      window.removeEventListener(EVENT, update)
    }
  }, [])
  return dark
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState(getThemePref)
  return [
    pref,
    (p) => {
      setPref(p)
      setThemePref(p)
    },
  ]
}
