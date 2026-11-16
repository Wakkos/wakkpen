import { useEffect, useState } from 'react'
import type { CssLang } from '../lib/types'
import { compileStyles } from '../lib/scss'
import { buildPreviewDoc } from '../lib/preview'

interface Props {
  html: string
  css: string
  cssLang: CssLang
  js: string
  delay?: number
}

export function Preview({ html, css, cssLang, js, delay = 800 }: Props) {
  const [doc, setDoc] = useState('')
  const [pending, setPending] = useState(false)
  const [scssError, setScssError] = useState<string | null>(null)

  useEffect(() => {
    setPending(true)
    let cancelled = false
    const t = setTimeout(async () => {
      const compiled = await compileStyles(css, cssLang)
      if (cancelled) return
      setScssError(compiled.error)
      if (!compiled.error) setDoc(buildPreviewDoc(html, compiled.css, js))
      setPending(false)
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [html, css, cssLang, js, delay])

  return (
    <div className="preview">
      <div className={`preview-frame${pending ? ' is-pending' : ''}`}>
        <iframe title="Vista previa" sandbox="allow-scripts allow-modals" srcDoc={doc} />
        {scssError && <div className="scss-error">{scssError}</div>}
      </div>
    </div>
  )
}
