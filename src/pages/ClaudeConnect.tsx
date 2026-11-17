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

const MCP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp`
const HEADER = 'X-API-Key'

export function ClaudeConnect() {
  const [tokens, setTokens] = useState<Token[] | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
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
    setFresh(data as string)
    setReveal(false)
    load()
  }

  async function revoke(t: Token) {
    if (!confirm(`¿Desconectar el enlace …${t.token_hint}? Claude dejará de tener acceso con él.`)) return
    await supabase.from('mcp_tokens').delete().eq('id', t.id)
    load()
  }

  async function copy(key: string, value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
  }

  const CopyBtn = ({ k, value }: { k: string; value: string }) => (
    <button className={`btn btn-sm ${copied === k ? 'is-done btn-ghost' : 'btn-ghost'}`} onClick={() => copy(k, value)}>
      {copied === k ? 'Copiado' : 'Copiar'}
    </button>
  )

  return (
    <Page>
      <div className="page-head">
        <h1>Conectar con Claude</h1>
        <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} onClick={create} disabled={busy}>
          Nuevo enlace
        </button>
      </div>

      <div className="mcp-fields">
        <label className="field">
          <span>URL del servidor</span>
          <div className="mcp-url">
            <code>{MCP_URL}</code>
            <CopyBtn k="url" value={MCP_URL} />
          </div>
        </label>
        <label className="field">
          <span>Nombre de la cabecera</span>
          <div className="mcp-url">
            <code>{HEADER}</code>
            <CopyBtn k="header" value={HEADER} />
          </div>
        </label>
        {fresh && (
          <label className="field mcp-token">
            <span>Token (valor de la cabecera)</span>
            <div className="mcp-url">
              <code className={reveal ? '' : 'is-hidden'}>{reveal ? fresh : '•'.repeat(32)}</code>
              <button className="btn btn-sm btn-ghost" onClick={() => setReveal((r) => !r)}>
                {reveal ? 'Ocultar' : 'Ver token'}
              </button>
              <CopyBtn k="token" value={fresh} />
            </div>
            <span className="hint left">Solo se muestra ahora. Quien tenga este token actúa como tú en Wakkpen.</span>
          </label>
        )}
        <ol className="mcp-steps">
          <li>En Claude: Ajustes → Conectores → Añadir conector personalizado. Pega la URL.</li>
          <li>Autenticación: «No sign-in». En «Request headers» elige {HEADER} en el desplegable y pega el token.</li>
          <li>Pídele, por ejemplo: «Crea en Wakkpen una hoja de 10 ejercicios de selectores CSS».</li>
        </ol>
      </div>

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
