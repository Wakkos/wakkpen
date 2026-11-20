// Borra un alumno: sus archivos de Storage y su usuario (perfil, pens y metadatos caen en cascada).
// Solo un profe, y solo para alumnos de sus sesiones o sin sesión. El service role vive aquí, nunca en el cliente.
import { createClient } from 'npm:@supabase/supabase-js@2'

const BUCKET = 'pen-assets'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''

  // Cliente con el JWT de quien llama: comprueba que es el profesor.
  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } })
  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'No autenticado' }, 401)

  let userId = ''
  try {
    userId = String((await req.json()).user_id ?? '')
  } catch {
    return json({ error: 'Cuerpo no válido' }, 400)
  }
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'user_id no válido' }, 400)
  if (userId === userData.user.id) return json({ error: 'No puedes borrarte a ti mismo' }, 400)
  // Solo alumnos de mis sesiones o sin ninguna sesión.
  const { data: allowed, error: rpcErr } = await caller.rpc('can_delete_user', { p_user: userId })
  if (rpcErr || allowed !== true) return json({ error: 'Solo puedes borrar alumnos de tus sesiones o sin sesión' }, 403)

  const admin = createClient(url, service, { auth: { persistSession: false } })

  // Archivos: {user_id}/{pen_id}/{archivo}. Se recorren las carpetas de pens para no dejar huérfanos.
  const { data: folders, error: listErr } = await admin.storage.from(BUCKET).list(userId, { limit: 1000 })
  if (listErr) return json({ error: listErr.message }, 500)
  const paths: string[] = []
  for (const folder of folders ?? []) {
    const { data: files } = await admin.storage.from(BUCKET).list(`${userId}/${folder.name}`, { limit: 1000 })
    for (const f of files ?? []) paths.push(`${userId}/${folder.name}/${f.name}`)
  }
  if (paths.length) {
    const { error } = await admin.storage.from(BUCKET).remove(paths)
    if (error) return json({ error: error.message }, 500)
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId)
  if (delErr) return json({ error: delErr.message }, 500)

  return json({ ok: true, files_removed: paths.length })
})
