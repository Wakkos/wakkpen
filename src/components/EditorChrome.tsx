import { useState } from 'react'
import type { CssLang } from '../lib/types'
import type { Layout } from './Workspace'

// Preferencias del editor guardadas en este navegador (si el almacenamiento falla, se quedan en memoria).
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  function set(v: T) {
    setValue(v)
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* sin almacenamiento */
    }
  }
  return [value, set]
}

export function PaneToggles({ hidden, onChange, cssLang }: { hidden: string[]; onChange: (h: string[]) => void; cssLang: CssLang }) {
  const panes: [string, string][] = [
    ['html', 'HTML'],
    ['css', cssLang.toUpperCase()],
    ['js', 'JS'],
  ]
  return (
    <div className="seg pane-toggles" role="group" aria-label="Paneles">
      {panes.map(([key, label]) => {
        const on = !hidden.includes(key)
        return (
          <button
            key={key}
            className={on ? 'is-on' : ''}
            aria-pressed={on}
            onClick={() => onChange(on ? [...hidden, key] : hidden.filter((h) => h !== key))}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  const next = layout === 'bottom' ? 'right' : 'bottom'
  return (
    <button className="icon-btn" onClick={() => onChange(next)} title={layout === 'bottom' ? 'Vista previa a la derecha' : 'Vista previa abajo'}>
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
        {layout === 'bottom' ? <path d="M10 2.5v11" /> : <path d="M1.5 9h13" />}
      </svg>
    </button>
  )
}

export function IconPopout() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
    </svg>
  )
}

export function IconQr() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="4.5" height="4.5" rx=".6" />
      <rect x="9.5" y="2" width="4.5" height="4.5" rx=".6" />
      <rect x="2" y="9.5" width="4.5" height="4.5" rx=".6" />
      <path d="M9.5 9.5h2v2M14 9.5v1M9.5 14h1.5M13 12.5V14h1" strokeLinecap="round" />
    </svg>
  )
}
