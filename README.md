# Wakkpen

Editor tipo CodePen para clase: HTML, CSS/SCSS y JS con vista previa, subida de archivos y un panel del profesor que ve en vivo lo que escribe cada alumno.

Stack: Vite + React + TypeScript en Vercel · Supabase (Auth, Postgres, Realtime, Storage, Edge Functions) · CodeMirror 6 · Sass en el navegador.

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # rellena URL y anon key
npm run dev
```

## Puesta en marcha

### 1. Proyecto de Supabase
1. Crea un proyecto en [supabase.com](https://supabase.com) (plan Free).
2. Aplica las migraciones de `supabase/migrations` en orden. Con la CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   O pega cada archivo en el SQL Editor, en orden.
3. Despliega la Edge Function:
   ```bash
   npx supabase functions deploy delete-user
   ```

### 2. Login por email
En **Authentication → URL Configuration**:
- **Site URL**: la URL de producción (p. ej. `https://code.tudominio.com`).
- **Redirect URLs**: añade la de producción y `http://localhost:5173`.

En **Authentication → Email Templates → Magic Link**, incluye también el código para que se pueda entrar escribiéndolo (útil cuando el enlace se abre en otro navegador):

```html
<h2>Entrar en Wakkpen</h2>
<p><a href="{{ .ConfirmationURL }}">Entrar</a></p>
<p>O escribe este código: <strong>{{ .Token }}</strong></p>
```

### 3. SMTP propio (obligatorio para usarlo en clase)
El SMTP que trae Supabase tiene un límite muy bajo de envíos por hora y fallará si varios alumnos piden el enlace a la vez.
1. Crea una cuenta en [Resend](https://resend.com) (plan Free) y verifica tu dominio (registros DNS que te indica).
2. Crea una API key.
3. En Supabase, **Project Settings → Authentication → SMTP Settings**: activa *Custom SMTP* con
   - Host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = la API key
   - Remitente: p. ej. `wakkpen@tudominio.com`
4. En **Authentication → Rate Limits**, sube el límite de emails por hora (p. ej. 60).

### 4. Hazte profesor
Entra una vez en la app con tu email y luego, en el SQL Editor:
```sql
update public.settings set value = 'tu@email.com' where key = 'teacher_email';
```
Tu rol pasa a `teacher` al momento (recarga la página).

### 5. Vercel
1. Importa el repo en Vercel (framework: Vite).
2. Variables de entorno: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
3. Despliega. `vercel.json` ya redirige todas las rutas a `index.html`.

### 6. Subdominio propio
En Vercel → Project → Settings → Domains, añade `code.tudominio.com`. En el DNS de tu dominio crea:
```
code   CNAME   cname.vercel-dns.com
```
Después actualiza Site URL y Redirect URLs en Supabase con ese dominio.

## A tener en cuenta
- **Pausa por inactividad**: en el plan Free, Supabase pausa el proyecto tras 7 días sin uso. Se reactiva desde el panel.
- **Archivos**: 2 MB por archivo y 10 archivos por usuario. Tipos: png, jpg, webp, gif, svg, woff, woff2, json.
- **Vista previa**: iframe con `sandbox="allow-scripts"` (origen opaco); el código del alumno no accede a la sesión de la app.
- **Presencia**: los alumnos anuncian en un canal común solo el id del pen que tienen abierto.
