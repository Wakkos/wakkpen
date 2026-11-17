import type { CssLang } from './types'

// Formateo con Prettier, solo para la vista del profe. Se carga bajo demanda (pesa bastante).
let loaded: Promise<{
  format: (code: string, opts: object) => Promise<string>
  plugins: object[]
}> | null = null

function load() {
  if (!loaded) {
    loaded = Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/html'),
      import('prettier/plugins/postcss'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]).then(([p, html, postcss, babel, estree]) => ({
      format: p.format as (code: string, opts: object) => Promise<string>,
      plugins: [html, postcss, babel, estree] as object[],
    }))
  }
  return loaded
}

async function safe(code: string, parser: string): Promise<string> {
  if (!code.trim()) return code
  const { format, plugins } = await load()
  try {
    return await format(code, { parser, plugins, printWidth: 100 })
  } catch {
    return code // con errores de sintaxis se muestra tal cual
  }
}

export async function formatPen(p: { html: string; css: string; css_lang: CssLang; js: string }) {
  const [html, css, js] = await Promise.all([
    safe(p.html, 'html'),
    safe(p.css, p.css_lang === 'scss' ? 'scss' : 'css'),
    safe(p.js, 'babel'),
  ])
  return { html, css, js }
}
