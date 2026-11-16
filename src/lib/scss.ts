import type { CssLang } from './types'

type SassModule = typeof import('sass')
let sassPromise: Promise<SassModule> | null = null

function loadSass(): Promise<SassModule> {
  if (!sassPromise) sassPromise = import('sass')
  return sassPromise
}

export interface CompiledCss {
  css: string
  error: string | null
}

export async function compileStyles(source: string, lang: CssLang): Promise<CompiledCss> {
  if (lang === 'css') return { css: source, error: null }
  try {
    const sass = await loadSass()
    const result = sass.compileString(source, { syntax: 'scss', style: 'expanded' })
    return { css: result.css, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { css: '', error: `SCSS: ${msg}` }
  }
}
