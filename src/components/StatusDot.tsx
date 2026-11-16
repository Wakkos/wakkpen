import type { SaveState } from '../lib/types'

const TITLES: Record<SaveState, string> = {
  idle: 'Sin cambios',
  saving: 'Guardando',
  saved: 'Guardado',
  error: 'Error al guardar',
}

export function StatusDot({ state }: { state: SaveState }) {
  return <span className={`status-dot status-${state}`} title={TITLES[state]} aria-label={TITLES[state]} />
}

export function LiveDot({ active, typing }: { active: boolean; typing?: boolean }) {
  return (
    <span
      className={`live-dot${active ? ' is-active' : ''}${typing ? ' is-typing' : ''}`}
      title={typing ? 'Escribiendo' : active ? 'Abierto ahora' : 'Sin actividad'}
    />
  )
}
