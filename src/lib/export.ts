import JSZip from 'jszip'
import type { Pen } from './types'
import { compileStyles } from './scss'
import { buildExportDoc } from './preview'
import { listFiles, publicUrl } from './files'

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'pen'
  )
}

export async function exportPen(pen: Pen): Promise<void> {
  const zip = new JSZip()
  const { css } = await compileStyles(pen.css, pen.css_lang)

  zip.file('index.html', buildExportDoc(pen.html, pen.title, pen.libs))
  zip.file('style.css', css)
  if (pen.css_lang === 'scss') zip.file('style.scss', pen.css)
  zip.file('script.js', pen.js)

  const files = await listFiles(pen.id)
  for (const f of files) {
    const res = await fetch(publicUrl(f.path))
    if (res.ok) zip.file(`assets/${f.name}`, await res.blob())
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${slug(pen.title)}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 10) return 'ahora'
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} d`
}
