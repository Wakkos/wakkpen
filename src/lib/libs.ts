// Librerías y fuentes que se pueden añadir a un pen con un clic.
// En pens.libs se guardan los ids; las URLs propias se guardan como "url:https://...".

export interface Lib {
  id: string
  name: string
  kind: 'css' | 'js' | 'font'
  url: string
}

const FONTS = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'DM Sans', 'Space Grotesk', 'Playfair Display', 'Lora', 'Bebas Neue', 'JetBrains Mono']

export const LIBS: Lib[] = [
  { id: 'modern-normalize', name: 'modern-normalize', kind: 'css', url: 'https://cdn.jsdelivr.net/npm/modern-normalize@3/modern-normalize.min.css' },
  { id: 'animate-css', name: 'Animate.css', kind: 'css', url: 'https://cdn.jsdelivr.net/npm/animate.css@4/animate.min.css' },
  { id: 'font-awesome', name: 'Font Awesome', kind: 'css', url: 'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/css/all.min.css' },
  { id: 'gsap', name: 'GSAP', kind: 'js', url: 'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js' },
  { id: 'gsap-scrolltrigger', name: 'GSAP ScrollTrigger', kind: 'js', url: 'https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js' },
  ...FONTS.map((f) => ({
    id: `font:${f}`,
    name: f,
    kind: 'font' as const,
    url: `https://fonts.googleapis.com/css2?family=${f.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`,
  })),
]

export function resolveLib(id: string): Lib | null {
  if (id.startsWith('url:')) {
    const url = id.slice(4)
    if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return null
    const kind = /\.css(\?|#|$)/i.test(url) || url.includes('fonts.googleapis.com') ? 'css' : 'js'
    return { id, name: url.replace(/^https:\/\//, ''), kind, url }
  }
  return LIBS.find((l) => l.id === id) ?? null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Etiquetas para el <head>: hojas y fuentes primero, scripts después (antes del código del alumno).
export function libTags(ids: string[] | undefined): { head: string; scripts: string } {
  const libs = (ids ?? []).map(resolveLib).filter((l): l is Lib => !!l)
  const fonts = libs.filter((l) => l.kind === 'font')
  const head = [
    fonts.length ? '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' : '',
    ...libs.filter((l) => l.kind !== 'js').map((l) => `<link rel="stylesheet" href="${esc(l.url)}">`),
  ]
    .filter(Boolean)
    .join('\n')
  const scripts = libs
    .filter((l) => l.kind === 'js')
    .map((l) => `<script src="${esc(l.url)}"></script>`)
    .join('\n')
  return { head, scripts }
}
