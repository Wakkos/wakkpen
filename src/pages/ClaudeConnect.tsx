import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/export'
import { Page } from '../components/Layout'

interface Token {
  id: string
  label: string
  token_hint: string
  created_at: string
  last_used_at: string | null
}

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp/`

export function ClaudeConnect() {
  const [tokens, setTokens] = useState<Token[] | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('mcp_tokens').select('id, label, token_hint, created_at, last_used_at').order('created_at', { ascending: false })
    setTokens((data as Token[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function create() {
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('create_mcp_token', { p_label: 'Claude' })
    setBusy(false)
    if (error) return setError(error.message)
    setFresh(`${BASE}${data as string}`)
    load()
  }

  async function revoke(t: Token) {
    if (!confirm(`¿Desconectar el enlace …${t.token_hint}? Claude dejará de tener acceso con él.`)) return
    await supabase.from('mcp_tokens').delete().eq('id', t.id)
    load()
  }

  async function copy() {
    if (!fresh) return
    await navigator.clipboard.writeText(fresh)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Page>
      <div className="page-head">
        <h1>Conectar con Claude</h1>
        <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} onClick={create} disabled={busy}>
          Nuevo enlace
        </button>
      </div>

      {fresh && (
        <div className="mcp-fresh">
          <div className="mcp-url">
            <code>{fresh}</code>
            <button className={`btn btn-sm ${copied ? 'is-done btn-ghost' : 'btn-primary'}`} onClick={copy}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <ol className="mcp-steps">
            <li>En Claude: Ajustes → Conectores → Añadir conector personalizado.</li>
            <li>Pega el enlace y guarda.</li>
            <li>Pídele por ejemplo: «Crea en Wakkpen una hoja de 10 ejercicios de selectores CSS».</li>
          </ol>
          <p className="hint left">Solo se muestra ahora. Quien tenga este enlace actúa como tú en Wakkpen: no lo compartas.</p>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {tokens && tokens.length > 0 && (
        <table className="table">
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.label}</strong> <span className="muted mono">…{t.token_hint}</span>
                </td>
                <td className="muted">creado {timeAgo(t.created_at)}</td>
                <td className="muted">{t.last_used_at ? `usado ${timeAgo(t.last_used_at)}` : 'sin usar'}</td>
                <td className="actions">
                  <button className="btn btn-danger btn-sm" onClick={() => revoke(t)}>
                    Desconectar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  )
}
