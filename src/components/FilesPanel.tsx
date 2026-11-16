import { useEffect, useRef, useState } from 'react'
import type { PenFile } from '../lib/types'
import { ACCEPT, deleteFile, listFiles, publicUrl, uploadFile } from '../lib/files'
import { MAX_FILES } from '../lib/supabase'

interface Props {
  penId: string
  userId: string
  readOnly?: boolean
  onClose: () => void
}

function kb(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function FilesPanel({ penId, userId, readOnly, onClose }: Props) {
  const [files, setFiles] = useState<PenFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listFiles(penId).then(setFiles).catch((e) => setError(e.message))
  }, [penId])

  async function onPick(list: FileList | null) {
    if (!list?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const f of Array.from(list)) {
        const created = await uploadFile(userId, penId, f)
        setFiles((prev) => [...prev, created])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function onDelete(f: PenFile) {
    if (!confirm(`¿Borrar ${f.name}?`)) return
    try {
      await deleteFile(f)
      setFiles((prev) => prev.filter((x) => x.id !== f.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function copy(f: PenFile) {
    await navigator.clipboard.writeText(publicUrl(f.path))
    setCopied(f.id)
    setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 1400)
  }

  return (
    <div className="drawer" role="dialog" aria-label="Archivos">
      <header className="drawer-header">
        <h2>Archivos</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </header>
      <ul className="file-list">
        {files.map((f) => (
          <li key={f.id} className="file-item">
            {f.mime.startsWith('image/') ? (
              <img src={publicUrl(f.path)} alt="" className="file-thumb" />
            ) : (
              <span className="file-thumb file-thumb-generic">{f.name.split('.').pop()}</span>
            )}
            <span className="file-name" title={f.name}>
              {f.name}
              <small>{kb(f.size)}</small>
            </span>
            <button className={`btn btn-ghost btn-sm${copied === f.id ? ' is-done' : ''}`} onClick={() => copy(f)}>
              {copied === f.id ? 'Copiada' : 'URL'}
            </button>
            {!readOnly && (
              <button className="icon-btn" onClick={() => onDelete(f)} aria-label={`Borrar ${f.name}`}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
      {!readOnly && (
        <>
          <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => onPick(e.target.files)} />
          <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Subiendo' : 'Subir archivo'}
          </button>
          <p className="hint">Máx. 2 MB · {MAX_FILES} archivos en total</p>
        </>
      )}
    </div>
  )
}
