// Servidor MCP de Wakkpen para Claude (transporte HTTP, JSON-RPC sin streaming).
// Autenticación: token del profesor en la cabecera "X-Wakkpen-Token" (recomendado), en "Authorization: Bearer" o al final de la URL.
// Todo se hace a nombre del profesor dueño del token. Claude puede crear y editar hojas en borrador y leer entregas;
// no puede publicar hojas ni soluciones. Corrige solo si el profe lo pide (grade_submission); si no, sugiere (suggest_grade).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, x-wakkpen-token, x-api-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// Cada ejercicio es un pen pequeño: HTML y CSS propios; el profe decide qué partes edita el alumno. Sin JavaScript.
const exerciseSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Título corto del ejercicio' },
    prompt: { type: 'string', description: 'Enunciado para el alumno. Usa `backticks` para el código.' },
    html: { type: 'string', description: 'HTML del ejercicio: un trocito pequeño, solo lo que el ejercicio necesita. Es el punto de partida si edit_html es true.' },
    css: { type: 'string', description: 'CSS del ejercicio (punto de partida si edit_css es true; puede ir vacío).' },
    edit_html: { type: 'boolean', description: 'El alumno puede editar el HTML. Por defecto false (lo ve en solo lectura).' },
    edit_css: { type: 'boolean', description: 'El alumno puede editar el CSS. Por defecto true.' },
    text_answer: { type: 'boolean', description: 'Añade un cuadro de respuesta escrita (predicciones, explicaciones). Por defecto false.' },
    show_preview: { type: 'boolean', description: 'El alumno ve el resultado mientras escribe. Por defecto false: lo ve al ser corregido.' },
    solution_html: { type: 'string', description: 'Solución: el HTML completo resuelto (solo si edit_html).' },
    solution_css: { type: 'string', description: 'Solución: el CSS completo resuelto (solo si edit_css).' },
    solution: { type: 'string', description: 'Explicación breve de la solución, o la respuesta escrita esperada si text_answer.' },
  },
  required: ['title', 'prompt'],
}

const TOOLS = [
  {
    name: 'list_sessions',
    description: 'Lista las sesiones del profesor (clases o sesiones sueltas): código, enlace para unirse, alumnos y hojas asignadas.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'assign_sheet',
    description: 'Asigna (o quita) una hoja a una sesión del profesor. Si la hoja ya está publicada, los alumnos de esa sesión reciben un aviso.',
    inputSchema: {
      type: 'object',
      properties: { sheet_id: { type: 'string' }, session_id: { type: 'string' }, assigned: { type: 'boolean', description: 'false para quitarla. Por defecto true.' } },
      required: ['sheet_id', 'session_id'],
    },
  },
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
        session_id: { type: 'string', description: 'Sesión a la que se asigna (opcional; ver list_sessions).' },
        exercises: { type: 'array', items: exerciseSchema },
      },
      required: ['title', 'exercises'],
    },
  },
  {
    name: 'update_sheet',
    description: 'Cambia el título o la introducción de una hoja. No publica.',
    inputSchema: {
      type: 'object',
      properties: { sheet_id: { type: 'string' }, title: { type: 'string' }, intro: { type: 'string' } },
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
    description: 'Edita un ejercicio: cualquier campo, la solución o la posición.',
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
    description: 'Lista los alumnos de las sesiones del profesor (nombre, email y sesiones), o los de una sesión.',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string', description: 'Opcional: solo esta sesión' } } },
  },
  {
    name: 'get_submissions',
    description:
      'Devuelve, por ejercicio, su HTML/CSS, qué partes edita el alumno y la solución; y las entregas: HTML/CSS del alumno en las partes editables, respuesta escrita, estado (submitted/ok/review) y comentario.',
    inputSchema: {
      type: 'object',
      properties: { sheet_id: { type: 'string' }, exercise_id: { type: 'string', description: 'Opcional: solo este ejercicio' } },
      required: ['sheet_id'],
    },
  },
  {
    name: 'grade_submission',
    description:
      'Corrige una entrega de verdad (ok o review) con un comentario breve para el alumno. Úsala SOLO cuando el profesor pida expresamente que corrijas; si no, usa suggest_grade. Compara su HTML/CSS y su respuesta escrita con la solución que da get_submissions. Queda marcada como corregida por Claude.',
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
type Sol = { solution: string; html: string; css: string }
const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const clip = (v: string | null | undefined, max = 4000) => (v && v.length > max ? v.slice(0, max) + '\n…(recortado)' : v ?? '')

const big = (v: unknown) => str(v, 50000)
// Algunos clientes mandan los booleanos como texto ("true").
const bool = (v: unknown) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined)

function exerciseRow(e: Args, sheetId: string, position: number) {
  return {
    sheet_id: sheetId,
    position,
    title: str(e.title, 200) ?? '',
    prompt: str(e.prompt) ?? '',
    html: big(e.html) ?? '',
    css: big(e.css) ?? '',
    edit_html: bool(e.edit_html) ?? false,
    edit_css: bool(e.edit_css) ?? true,
    text_answer: bool(e.text_answer) ?? false,
    show_preview: bool(e.show_preview) ?? false,
  }
}

const solutionRow = (id: string, e: Args) => ({
  exercise_id: id,
  solution: str(e.solution) ?? '',
  html: big(e.solution_html) ?? '',
  css: big(e.solution_css) ?? '',
})

async function insertExercises(db: SupabaseClient, sheetId: string, list: Args[], start: number) {
  const created = []
  for (const [i, e] of list.entries()) {
    const { data, error } = await db.from('exercises').insert(exerciseRow(e, sheetId, start + i)).select('id, title').single()
    if (error) throw new Error(error.message)
    await db.from('exercise_solutions').upsert(solutionRow(data.id, e))
    created.push(data)
  }
  return created
}

// ---------- Lo que puede tocar cada profe (el cliente usa el service role: aquí se acota) ----------
async function mySessionIds(db: SupabaseClient, teacherId: string): Promise<string[]> {
  const { data } = await db.from('session_teachers').select('session_id').eq('user_id', teacherId)
  return (data ?? []).map((r: Args) => r.session_id as string)
}

// Hojas que gestiona: las suyas y las asignadas a sus sesiones.
async function mySheetIds(db: SupabaseClient, teacherId: string): Promise<string[]> {
  const sessions = await mySessionIds(db, teacherId)
  const [{ data: own }, { data: linked }] = await Promise.all([
    db.from('exercise_sheets').select('id').eq('created_by', teacherId),
    sessions.length ? db.from('session_sheets').select('sheet_id').in('session_id', sessions) : Promise.resolve({ data: [] }),
  ])
  return [...new Set([...(own ?? []).map((r: Args) => r.id as string), ...(linked ?? []).map((r: Args) => r.sheet_id as string)])]
}

async function guard(db: SupabaseClient, teacherId: string, a: Args) {
  const nope = () => {
    throw new Error('No encontrado o no es de tus hojas/sesiones')
  }
  const sheets = () => mySheetIds(db, teacherId)
  if (typeof a.session_id === 'string' && !(await mySessionIds(db, teacherId)).includes(a.session_id)) nope()
  if (typeof a.sheet_id === 'string' && !(await sheets()).includes(a.sheet_id)) nope()
  if (typeof a.exercise_id === 'string') {
    const { data } = await db.from('exercises').select('sheet_id').eq('id', a.exercise_id).maybeSingle()
    if (!data || !(await sheets()).includes(data.sheet_id)) nope()
  }
  if (typeof a.submission_id === 'string') {
    const { data } = await db.from('submissions').select('exercises(sheet_id)').eq('id', a.submission_id).maybeSingle()
    const sheet = (data as { exercises: { sheet_id: string } | null } | null)?.exercises?.sheet_id
    if (!sheet || !(await sheets()).includes(sheet)) nope()
  }
}

async function runTool(db: SupabaseClient, teacherId: string, name: string, a: Args): Promise<unknown> {
  await guard(db, teacherId, a)
  switch (name) {
    case 'list_sessions': {
      const ids = await mySessionIds(db, teacherId)
      if (!ids.length) return []
      const { data } = await db
        .from('sessions')
        .select('id, code, title, is_open, archived, session_members(count), session_sheets(exercise_sheets(id, title))')
        .in('id', ids)
        .order('created_at', { ascending: false })
      return (data ?? []).map((s: Args & { session_members: { count: number }[]; session_sheets: { exercise_sheets: Args | null }[] }) => ({
        id: s.id,
        title: s.title,
        code: s.code,
        link: `https://code.wakkos.com/s/${s.code}`,
        open: s.is_open,
        archived: s.archived,
        students: s.session_members?.[0]?.count ?? 0,
        sheets: s.session_sheets.map((x) => x.exercise_sheets).filter(Boolean),
      }))
    }
    case 'assign_sheet': {
      if (a.assigned === false || a.assigned === 'false') {
        await db.from('session_sheets').delete().eq('session_id', a.session_id).eq('sheet_id', a.sheet_id)
        return { ok: true }
      }
      const { error } = await db.from('session_sheets').upsert({ session_id: a.session_id, sheet_id: a.sheet_id })
      if (error) throw new Error(error.message)
      return { ok: true }
    }
    case 'list_sheets': {
      const ids = await mySheetIds(db, teacherId)
      if (!ids.length) return []
      const { data, error } = await db
        .from('exercise_sheets')
        .select('id, title, published, updated_at, exercises(id, submissions(count)), session_sheets(sessions(title))')
        .in('id', ids)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map((s: Args & { exercises: { submissions: { count: number }[] }[]; session_sheets: { sessions: { title: string } | null }[] }) => ({
        id: s.id,
        title: s.title,
        published: s.published,
        sessions: s.session_sheets.map((x) => x.sessions?.title).filter(Boolean),
        exercises: s.exercises.length,
        submissions: s.exercises.reduce((n, e) => n + (e.submissions?.[0]?.count ?? 0), 0),
        updated_at: s.updated_at,
      }))
    }
    case 'get_sheet': {
      const { data: s, error } = await db.from('exercise_sheets').select('*').eq('id', a.sheet_id).maybeSingle()
      if (error || !s) throw new Error('Hoja no encontrada')
      const { data: ex } = await db.from('exercises').select('*, exercise_solutions(solution, html, css)').eq('sheet_id', s.id).order('position')
      return {
        ...s,
        exercises: (ex ?? []).map((e: Args & { exercise_solutions: Sol | null }) => {
          const { exercise_solutions: sol, ...rest } = e
          return { ...rest, solution: sol?.solution ?? '', solution_html: sol?.html ?? '', solution_css: sol?.css ?? '' }
        }),
      }
    }
    case 'create_sheet': {
      const { data: s, error } = await db
        .from('exercise_sheets')
        .insert({ title: str(a.title, 160) || 'Nueva hoja', intro: str(a.intro) ?? '', published: false, created_by: teacherId })
        .select('id, title')
        .single()
      if (error) throw new Error(error.message)
      if (typeof a.session_id === 'string') await db.from('session_sheets').insert({ session_id: a.session_id, sheet_id: s.id })
      const created = await insertExercises(db, s.id, (a.exercises as Args[]) ?? [], 0)
      return { sheet: s, exercises: created, note: 'Creada en borrador. El profesor la revisa y la publica desde Wakkpen.' }
    }
    case 'update_sheet': {
      const patch: Args = {}
      if (str(a.title, 160)) patch.title = str(a.title, 160)
      if (typeof a.intro === 'string') patch.intro = str(a.intro)
      const { data, error } = await db.from('exercise_sheets').update(patch).eq('id', a.sheet_id).select('id, title, intro').single()
      if (error) throw new Error(error.message)
      return data
    }
    case 'add_exercises': {
      const { data: s } = await db.from('exercise_sheets').select('id').eq('id', a.sheet_id).maybeSingle()
      if (!s) throw new Error('Hoja no encontrada')
      const { count } = await db.from('exercises').select('id', { count: 'exact', head: true }).eq('sheet_id', s.id)
      return { exercises: await insertExercises(db, s.id, (a.exercises as Args[]) ?? [], count ?? 0) }
    }
    case 'update_exercise': {
      const patch: Args = {}
      if (typeof a.title === 'string') patch.title = str(a.title, 200)
      if (typeof a.prompt === 'string') patch.prompt = str(a.prompt)
      for (const k of ['html', 'css']) if (typeof a[k] === 'string') patch[k] = big(a[k])
      for (const k of ['edit_html', 'edit_css', 'text_answer', 'show_preview']) if (bool(a[k]) !== undefined) patch[k] = bool(a[k])
      if (Number.isInteger(a.position)) patch.position = a.position
      if (Object.keys(patch).length) {
        const { error } = await db.from('exercises').update(patch).eq('id', a.exercise_id)
        if (error) throw new Error(error.message)
      }
      const sol: Args = {}
      if (typeof a.solution === 'string') sol.solution = str(a.solution)
      if (typeof a.solution_html === 'string') sol.html = big(a.solution_html)
      if (typeof a.solution_css === 'string') sol.css = big(a.solution_css)
      if (Object.keys(sol).length) {
        const { error } = await db.from('exercise_solutions').upsert({ exercise_id: a.exercise_id, ...sol })
        if (error) throw new Error(error.message)
      }
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
      const ids = typeof a.session_id === 'string' ? [a.session_id] : await mySessionIds(db, teacherId)
      if (!ids.length) return []
      const { data } = await db.from('session_members').select('profiles(id, nombre, email), sessions(title)').in('session_id', ids)
      const out: Record<string, { nombre: string; email: string; sessions: string[] }> = {}
      for (const r of (data ?? []) as { profiles: { id: string; nombre: string; email: string } | null; sessions: { title: string } | null }[]) {
        if (!r.profiles) continue
        const o = (out[r.profiles.id] ??= { nombre: r.profiles.nombre, email: r.profiles.email, sessions: [] })
        if (r.sessions) o.sessions.push(r.sessions.title)
      }
      return Object.values(out).sort((x, y) => x.nombre.localeCompare(y.nombre))
    }
    case 'get_submissions': {
      let q = db
        .from('exercises')
        .select('id, position, title, prompt, html, css, edit_html, edit_css, text_answer, exercise_solutions(solution, html, css)')
        .eq('sheet_id', a.sheet_id)
        .order('position')
      if (typeof a.exercise_id === 'string') q = q.eq('id', a.exercise_id)
      const { data: ex } = await q
      const ids = (ex ?? []).map((e: Args) => e.id as string)
      if (!ids.length) return []
      const { data: subs } = await db
        .from('submissions')
        .select('id, exercise_id, answer, answer_html, answer_css, status, comment, submitted_at, graded_by, profiles(nombre)')
        .in('exercise_id', ids)
      return (ex ?? []).map((e: Args & { exercise_solutions: Sol | null }) => {
        const sol = e.exercise_solutions
        return {
          exercise_id: e.id,
          number: (e.position as number) + 1,
          title: e.title,
          prompt: e.prompt,
          html: clip(e.html as string, 8000),
          css: clip(e.css as string, 8000),
          edit_html: e.edit_html,
          edit_css: e.edit_css,
          text_answer: e.text_answer,
          solution_html: e.edit_html ? clip(sol?.html || (e.html as string), 8000) : undefined,
          solution_css: e.edit_css ? clip(sol?.css || (e.css as string), 8000) : undefined,
          solution: sol?.solution ?? '',
          submissions: (subs ?? [])
            .filter((s: Args) => s.exercise_id === e.id)
            .map((s: Args & { profiles: { nombre: string } | null }) => ({
              submission_id: s.id,
              student: s.profiles?.nombre,
              answer_html: e.edit_html ? clip(s.answer_html as string, 8000) : undefined,
              answer_css: e.edit_css ? clip(s.answer_css as string, 8000) : undefined,
              written_answer: e.text_answer ? clip(s.answer as string, 6000) : undefined,
              status: s.status,
              teacher_comment: s.comment,
              graded_by: s.graded_by,
              submitted_at: s.submitted_at,
            })),
        }
      })
    }
    case 'suggest_grade': {
      if (a.status !== 'ok' && a.status !== 'review') throw new Error('status debe ser ok o review')
      const { error } = await db
        .from('grade_suggestions')
        .upsert({ submission_id: a.submission_id, status: a.status, comment: str(a.comment, 2000) ?? '', created_at: new Date().toISOString() })
      if (error) throw new Error(error.message)
      return { ok: true, note: 'Sugerencia guardada. El profesor decide si la aplica.' }
    }
    case 'grade_submission': {
      if (a.status !== 'ok' && a.status !== 'review') throw new Error('status debe ser ok o review')
      const { data, error } = await db
        .from('submissions')
        .update({ status: a.status, comment: str(a.comment, 2000) ?? '', graded_at: new Date().toISOString(), graded_by: 'claude' })
        .eq('id', a.submission_id)
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Entrega no encontrada')
      await db.from('grade_suggestions').delete().eq('submission_id', a.submission_id)
      return { ok: true, note: 'Corregida. Queda marcada como corregida por Claude; el profesor puede cambiarla.' }
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
  // Cualquier cabecera vale (X-API-Key, Authorization: Bearer, X-Wakkpen-Token…): se busca el valor que empiece por wkp_.
  const fromHeader = [...req.headers.values()].map((h) => h.replace(/^Bearer\s+/i, '').trim()).find((h) => h.startsWith('wkp_')) ?? ''
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
              serverInfo: { name: 'wakkpen', version: '0.4.0' },
              instructions:
                'Wakkpen es la herramienta de clase de frontend del profesor. Crea hojas de ejercicios breves (3–5 min) en español, con enunciados claros, ' +
                'código entre `backticks` y una solución por ejercicio. Cada ejercicio es un pen pequeño con su propio HTML y CSS (trocitos cortos, solo lo necesario); ' +
                'edit_html / edit_css dicen qué parte puede tocar el alumno, y la solución es el HTML/CSS completo de esa parte. Sin JavaScript. ' +
                'Cada profe trabaja con sus sesiones (list_sessions) y sus hojas; al crear una hoja puedes asignarla a una sesión. ' +
                'Las hojas se crean en borrador. Para corregir: suggest_grade por defecto; grade_submission solo si el profesor pide expresamente que corrijas.',
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
