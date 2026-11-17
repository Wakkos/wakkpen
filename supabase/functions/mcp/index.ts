// Servidor MCP de Wakkpen para Claude (transporte HTTP, JSON-RPC sin streaming).
// Autenticación: token del profesor en la cabecera "X-Wakkpen-Token" (recomendado), en "Authorization: Bearer" o al final de la URL.
// Todo se hace a nombre del profesor dueño del token. Claude puede crear y editar hojas en borrador y leer entregas;
// no puede publicar hojas ni soluciones, ni corregir: solo deja sugerencias que el profe confirma.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, x-wakkpen-token',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const LANGS = ['html', 'css', 'js']
const exerciseSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Título corto del ejercicio' },
    prompt: { type: 'string', description: 'Enunciado para el alumno. Usa `backticks` para el código.' },
    answer_kind: { type: 'string', enum: ['code', 'text'], description: 'code: el alumno escribe código; text: responde con texto (predicciones, explicaciones)' },
    lang: { type: 'string', enum: LANGS, description: 'Lenguaje del cuadro de código (si answer_kind es code)' },
    allow_pen: { type: 'boolean', description: 'Si el alumno puede adjuntar una copia de su pen' },
    solution: { type: 'string', description: 'Solución. Queda oculta hasta que el profesor la publique.' },
  },
  required: ['title', 'prompt'],
}

const TOOLS = [
  {
    name: 'list_sheets',
    description: 'Lista las hojas de ejercicios con su estado (borrador/publicada), número de ejercicios y de entregas.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_sheet',
    description: 'Devuelve una hoja con todos sus ejercicios, incluidas las soluciones.',
    inputSchema: { type: 'object', properties: { sheet_id: { type: 'string' } }, required: ['sheet_id'] },
  },
  {
    name: 'create_sheet',
    description: 'Crea una hoja de ejercicios nueva en BORRADOR (los alumnos no la ven hasta que el profesor la publique en Wakkpen).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        intro: { type: 'string', description: 'Introducción opcional para los alumnos' },
        lang: { type: 'string', enum: LANGS, description: 'Lenguaje por defecto de la hoja' },
        exercises: { type: 'array', items: exerciseSchema },
      },
      required: ['title', 'exercises'],
    },
  },
  {
    name: 'update_sheet',
    description: 'Cambia el título, la introducción o el lenguaje por defecto de una hoja. No publica.',
    inputSchema: {
      type: 'object',
      properties: { sheet_id: { type: 'string' }, title: { type: 'string' }, intro: { type: 'string' }, lang: { type: 'string', enum: LANGS } },
      required: ['sheet_id'],
    },
  },
  {
    name: 'add_exercises',
    description: 'Añade ejercicios al final de una hoja.',
    inputSchema: {
      type: 'object',
      properties: { sheet_id: { type: 'string' }, exercises: { type: 'array', items: exerciseSchema } },
      required: ['sheet_id', 'exercises'],
    },
  },
  {
    name: 'update_exercise',
    description: 'Edita un ejercicio (título, enunciado, tipo, lenguaje, adjuntar pen, solución o posición).',
    inputSchema: {
      type: 'object',
      properties: { exercise_id: { type: 'string' }, ...exerciseSchema.properties, position: { type: 'integer' } },
      required: ['exercise_id'],
    },
  },
  {
    name: 'delete_exercise',
    description: 'Borra un ejercicio de una hoja que todavía no tenga entregas.',
    inputSchema: { type: 'object', properties: { exercise_id: { type: 'string' } }, required: ['exercise_id'] },
  },
  {
    name: 'list_students',
    description: 'Lista los alumnos (nombre y email).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_submissions',
    description:
      'Devuelve las entregas de una hoja (o de un ejercicio): respuesta de cada alumno, estado (submitted/ok/review), comentario del profesor y, si adjuntó su pen, su HTML/CSS (recortado).',
    inputSchema: {
      type: 'object',
      properties: { sheet_id: { type: 'string' }, exercise_id: { type: 'string', description: 'Opcional: solo este ejercicio' } },
      required: ['sheet_id'],
    },
  },
  {
    name: 'suggest_grade',
    description:
      'Propone una corrección para una entrega (ok o review) con un comentario breve para el alumno. NO se aplica: el profesor la ve en Wakkpen y decide si la acepta.',
    inputSchema: {
      type: 'object',
      properties: {
        submission_id: { type: 'string' },
        status: { type: 'string', enum: ['ok', 'review'] },
        comment: { type: 'string', description: 'Comentario breve, en español, dirigido al alumno' },
      },
      required: ['submission_id', 'status'],
    },
  },
]

type Args = Record<string, unknown>
const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const clip = (v: string | null | undefined, max = 4000) => (v && v.length > max ? v.slice(0, max) + '\n…(recortado)' : v ?? '')

function exerciseRow(e: Args, sheetId: string, position: number, lang: string) {
  return {
    sheet_id: sheetId,
    position,
    title: str(e.title, 200) ?? '',
    prompt: str(e.prompt) ?? '',
    answer_kind: e.answer_kind === 'text' ? 'text' : 'code',
    lang: LANGS.includes(e.lang as string) ? (e.lang as string) : lang,
    allow_pen: typeof e.allow_pen === 'boolean' ? e.allow_pen : true,
  }
}

async function insertExercises(db: SupabaseClient, sheetId: string, list: Args[], start: number, lang: string) {
  const created = []
  for (const [i, e] of list.entries()) {
    const { data, error } = await db.from('exercises').insert(exerciseRow(e, sheetId, start + i, lang)).select('id, title').single()
    if (error) throw new Error(error.message)
    await db.from('exercise_solutions').upsert({ exercise_id: data.id, solution: str(e.solution) ?? '' })
    created.push(data)
  }
  return created
}

async function runTool(db: SupabaseClient, teacherId: string, name: string, a: Args): Promise<unknown> {
  switch (name) {
    case 'list_sheets': {
      const { data, error } = await db
        .from('exercise_sheets')
        .select('id, title, published, lang, updated_at, exercises(id, submissions(count))')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map((s: Args & { exercises: { submissions: { count: number }[] }[] }) => ({
        id: s.id,
        title: s.title,
        published: s.published,
        lang: s.lang,
        exercises: s.exercises.length,
        submissions: s.exercises.reduce((n, e) => n + (e.submissions?.[0]?.count ?? 0), 0),
        updated_at: s.updated_at,
      }))
    }
    case 'get_sheet': {
      const { data: s, error } = await db.from('exercise_sheets').select('*').eq('id', a.sheet_id).maybeSingle()
      if (error || !s) throw new Error('Hoja no encontrada')
      const { data: ex } = await db.from('exercises').select('*, exercise_solutions(solution)').eq('sheet_id', s.id).order('position')
      return {
        ...s,
        exercises: (ex ?? []).map((e: Args & { exercise_solutions: { solution: string } | null }) => {
          const { exercise_solutions, ...rest } = e
          return { ...rest, solution: exercise_solutions?.solution ?? '' }
        }),
      }
    }
    case 'create_sheet': {
      const lang = LANGS.includes(a.lang as string) ? (a.lang as string) : 'css'
      const { data: s, error } = await db
        .from('exercise_sheets')
        .insert({ title: str(a.title, 160) || 'Nueva hoja', intro: str(a.intro) ?? '', lang, published: false, created_by: teacherId })
        .select('id, title')
        .single()
      if (error) throw new Error(error.message)
      const created = await insertExercises(db, s.id, (a.exercises as Args[]) ?? [], 0, lang)
      return { sheet: s, exercises: created, note: 'Creada en borrador. El profesor la revisa y la publica desde Wakkpen.' }
    }
    case 'update_sheet': {
      const patch: Args = {}
      if (str(a.title, 160)) patch.title = str(a.title, 160)
      if (typeof a.intro === 'string') patch.intro = str(a.intro)
      if (LANGS.includes(a.lang as string)) patch.lang = a.lang
      const { data, error } = await db.from('exercise_sheets').update(patch).eq('id', a.sheet_id).select('id, title, intro, lang').single()
      if (error) throw new Error(error.message)
      return data
    }
    case 'add_exercises': {
      const { data: s } = await db.from('exercise_sheets').select('id, lang').eq('id', a.sheet_id).maybeSingle()
      if (!s) throw new Error('Hoja no encontrada')
      const { count } = await db.from('exercises').select('id', { count: 'exact', head: true }).eq('sheet_id', s.id)
      return { exercises: await insertExercises(db, s.id, (a.exercises as Args[]) ?? [], count ?? 0, s.lang) }
    }
    case 'update_exercise': {
      const patch: Args = {}
      if (typeof a.title === 'string') patch.title = str(a.title, 200)
      if (typeof a.prompt === 'string') patch.prompt = str(a.prompt)
      if (a.answer_kind === 'code' || a.answer_kind === 'text') patch.answer_kind = a.answer_kind
      if (LANGS.includes(a.lang as string)) patch.lang = a.lang
      if (typeof a.allow_pen === 'boolean') patch.allow_pen = a.allow_pen
      if (Number.isInteger(a.position)) patch.position = a.position
      if (Object.keys(patch).length) {
        const { error } = await db.from('exercises').update(patch).eq('id', a.exercise_id)
        if (error) throw new Error(error.message)
      }
      if (typeof a.solution === 'string') await db.from('exercise_solutions').upsert({ exercise_id: a.exercise_id, solution: str(a.solution) })
      return { ok: true }
    }
    case 'delete_exercise': {
      const { count } = await db.from('submissions').select('id', { count: 'exact', head: true }).eq('exercise_id', a.exercise_id)
      if (count) throw new Error('Este ejercicio ya tiene entregas; bórralo desde Wakkpen si de verdad quieres perderlas.')
      const { error } = await db.from('exercises').delete().eq('id', a.exercise_id)
      if (error) throw new Error(error.message)
      return { ok: true }
    }
    case 'list_students': {
      const { data } = await db.from('profiles').select('id, nombre, email').eq('role', 'student').order('nombre')
      return data ?? []
    }
    case 'get_submissions': {
      let q = db.from('exercises').select('id, position, title').eq('sheet_id', a.sheet_id).order('position')
      if (typeof a.exercise_id === 'string') q = q.eq('id', a.exercise_id)
      const { data: ex } = await q
      const ids = (ex ?? []).map((e: Args) => e.id as string)
      if (!ids.length) return []
      const { data: subs } = await db
        .from('submissions')
        .select('id, exercise_id, answer, status, comment, submitted_at, pen_snapshot, profiles(nombre)')
        .in('exercise_id', ids)
      return (ex ?? []).map((e: Args) => ({
        exercise_id: e.id,
        number: (e.position as number) + 1,
        title: e.title,
        submissions: (subs ?? [])
          .filter((s: Args) => s.exercise_id === e.id)
          .map((s: Args & { profiles: { nombre: string } | null; pen_snapshot: Args | null }) => ({
            submission_id: s.id,
            student: s.profiles?.nombre,
            answer: clip(s.answer as string, 6000),
            status: s.status,
            teacher_comment: s.comment,
            submitted_at: s.submitted_at,
            pen: s.pen_snapshot
              ? { title: s.pen_snapshot.title, html: clip(s.pen_snapshot.html as string), css: clip(s.pen_snapshot.css as string) }
              : null,
          })),
      }))
    }
    case 'suggest_grade': {
      if (a.status !== 'ok' && a.status !== 'review') throw new Error('status debe ser ok o review')
      const { error } = await db
        .from('grade_suggestions')
        .upsert({ submission_id: a.submission_id, status: a.status, comment: str(a.comment, 2000) ?? '', created_at: new Date().toISOString() })
      if (error) throw new Error(error.message)
      return { ok: true, note: 'Sugerencia guardada. El profesor decide si la aplica.' }
    }
  }
  throw new Error(`Herramienta desconocida: ${name}`)
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Usa POST (MCP sobre HTTP)' }, 405)

  // Token: último segmento de la ruta o cabecera Authorization.
  const url = new URL(req.url)
  const fromPath = url.pathname.split('/').filter(Boolean).pop() ?? ''
  const fromHeader = req.headers.get('X-Wakkpen-Token') ?? (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const token = fromPath.startsWith('wkp_') ? fromPath : fromHeader.startsWith('wkp_') ? fromHeader : ''
  if (!token) return json({ error: 'Falta el token' }, 401)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: tok } = await db.from('mcp_tokens').select('id, user_id, profiles(role)').eq('token_hash', await sha256(token)).maybeSingle()
  const role = (tok as { profiles?: { role?: string } } | null)?.profiles?.role
  if (!tok || role !== 'teacher') return json({ error: 'Token no válido' }, 401)
  db.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id).then()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido' } }, 400)
  }

  const handle = async (msg: { id?: unknown; method?: string; params?: Args }) => {
    const { id, method, params = {} } = msg
    if (id === undefined || id === null) return null // notificación
    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: (params.protocolVersion as string) ?? '2025-06-18',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'wakkpen', version: '0.1.0' },
              instructions:
                'Wakkpen es la herramienta de clase de frontend del profesor. Crea hojas de ejercicios breves (3–5 min) en español, con enunciados claros, ' +
                'código entre `backticks` y una solución por ejercicio. Las hojas se crean en borrador. Para corregir, usa suggest_grade: el profesor confirma.',
            },
          }
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} }
        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
        case 'tools/call': {
          try {
            const out = await runTool(db, tok.user_id, params.name as string, (params.arguments as Args) ?? {})
            return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } }
          } catch (e) {
            return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] } }
          }
        }
        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Método no soportado: ${method}` } }
      }
    } catch (e) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }
    }
  }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean)
    return out.length ? json(out) : new Response(null, { status: 202, headers: cors })
  }
  const out = await handle(body as never)
  return out ? json(out) : new Response(null, { status: 202, headers: cors })
})
