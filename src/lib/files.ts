import { supabase, BUCKET, MAX_FILE_BYTES, MAX_FILES } from './supabase'
import type { PenFile } from './types'

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json',
}

export const ACCEPT = Object.keys(MIME_BY_EXT).map((e) => '.' + e).join(',')

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function safeName(name: string): string {
  const ext = extOf(name)
  const base = name.slice(0, name.length - (ext ? ext.length + 1 : 0))
  const clean = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'archivo'
  return ext ? `${clean}.${ext}` : clean
}

export function publicUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

export async function listFiles(penId: string): Promise<PenFile[]> {
  const { data, error } = await supabase
    .from('pen_files')
    .select('*')
    .eq('pen_id', penId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as PenFile[]
}

export async function countMyFiles(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('pen_files')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
  if (error) throw error
  return count ?? 0
}

export async function uploadFile(userId: string, penId: string, file: File): Promise<PenFile> {
  const mime = MIME_BY_EXT[extOf(file.name)]
  if (!mime) throw new Error('Tipo de archivo no permitido')
  if (file.size > MAX_FILE_BYTES) throw new Error('El archivo pasa de 2 MB')
  if ((await countMyFiles(userId)) >= MAX_FILES) throw new Error(`Límite de ${MAX_FILES} archivos alcanzado`)

  let name = safeName(file.name)
  const existing = await listFiles(penId)
  if (existing.some((f) => f.name === name)) {
    const ext = extOf(name)
    const base = name.slice(0, name.length - ext.length - 1)
    name = `${base}-${Date.now().toString(36)}.${ext}`
  }
  const path = `${userId}/${penId}/${name}`

  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false })
  if (up.error) throw up.error

  const { data, error } = await supabase
    .from('pen_files')
    .insert({ pen_id: penId, path, name })
    .select('*')
    .single()
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  return data as PenFile
}

export async function deleteFile(file: PenFile): Promise<void> {
  const rm = await supabase.storage.from(BUCKET).remove([file.path])
  if (rm.error) throw rm.error
  const { error } = await supabase.from('pen_files').delete().eq('id', file.id)
  if (error) throw error
}

export async function deletePenWithFiles(penId: string): Promise<void> {
  const files = await listFiles(penId)
  if (files.length) {
    const rm = await supabase.storage.from(BUCKET).remove(files.map((f) => f.path))
    if (rm.error) throw rm.error
  }
  const { error } = await supabase.from('pens').delete().eq('id', penId)
  if (error) throw error
}
