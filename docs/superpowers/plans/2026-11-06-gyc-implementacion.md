# GyC — Gestión y Construcción: Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar la SPA LPS-GES al stack GitHub + Vercel + Neon + Clerk, copiando toda su estructura y reemplazando la capa de Supabase.

**Architecture:** La SPA (app/) se sirve desde Vercel. Las peticiones de datos van a Vercel Functions (`/api/`), que validan el JWT de Clerk y consultan Neon (PostgreSQL). El adaptador de datos del navegador (`adapter-api.js`) mantiene la misma interfaz que el anterior `adapter-supabase.js` para que las vistas no cambien.

**Tech Stack:** Vanilla JS ES modules, Tabulator, SheetJS, Chart.js (frontend); Node.js 20 Vercel Functions, `@neondatabase/serverless`, `@clerk/backend` (backend); PostgreSQL en Neon (DB); Clerk (auth).

**Spec:** `docs/superpowers/specs/2026-11-06-gyc-arquitectura-design.md`

## Global Constraints

- Repositorio: `ehchavezm-hub/13-GyC` (nunca tocar `11-LPS-GES`)
- Variable global de config en el navegador: `window.GYC_CONFIG` (antes `window.LPSGT_CONFIG`)
- No identificadores de modelos de IA en commits ni archivos
- Nunca exponer `DATABASE_URL` ni `CLERK_SECRET_KEY` en el frontend
- Las migraciones SQL las ejecuta el dueño en Neon SQL Editor; entregar el archivo y verificar con solo lectura
- **Clerk IDs**: `profiles.id` cambia de `UUID` a `TEXT` para almacenar el ID de Clerk (`user_abc123`). La migración `032_clerk_ids.sql` hace este cambio. Todas las FK a `profiles.id` cambian a `TEXT` también.
- `adapter-api.js` mantiene exactamente la misma interfaz pública que `adapter-supabase.js` (mismos nombres de métodos y firmas)
- `auth.usuario()` retorna `{ id: clerkUserId, email }` donde `id` coincide con `profiles.id` en Neon
- El modo demo (`?demo` / `adapter-demo.js`) no cambia
- Secretos solo en Vercel Environment Variables

## Review Focus

- **Token Clerk ausente en requests desde el browser**: la Vercel Function debe responder 401, no 500 ni datos vacíos.
- **Primer login: perfil inexistente en Neon**: el middleware de auth debe crear el registro en `profiles` antes de continuar, no lanzar error de FK.
- **SQL injection via parámetros de tabla/columna en `/api/datos`**: los nombres de tabla y columna deben validarse contra una whitelist, nunca interpolados en el SQL directo.
- **Realtime suprimido**: `subscribe()` retorna un unsubscriber no-op; las vistas que dependen de actualizaciones en tiempo real deben mostrar datos en el estado que tenían al cargar (sin crash).
- **Modo demo con `window.GYC_CONFIG` sin claves**: `api.js` debe detectar ausencia de `clerkPublishableKey` o `apiBase` y activar modo demo automáticamente, igual que antes con Supabase.

---

### Task 1: Copiar estructura LPS-GES → 13-GyC y renombrar referencias base

**Files:**
- Create: `app/` (copia completa desde `11-lps-ges/app/`, con cambios de nombre)
- Create: `pruebas/` (copia desde `11-lps-ges/pruebas/`)
- Create: `db/migrations/` (copia desde `11-lps-ges/supabase/migrations/`)
- Create: `db/tests/` (copia desde `11-lps-ges/supabase/tests/`)
- Create: `.github/workflows/pruebas.yml` (copia de `11-lps-ges/.github/workflows/pruebas.yml`)
- Create: `.github/workflows/migraciones.yml` (copia)
- Create: `.gitignore`
- Delete/omit: `app/vendor/supabase.min.js`, `app/js/data/adapter-supabase.js`
- Delete/omit: `.github/workflows/publicar.yml`, `respaldo.yml`, `funciones.yml`

**Interfaces:**
- Produces: estructura de carpetas completa en `/home/user/13-gyc/`; `window.GYC_CONFIG` en `app/config.js`; sin referencias a `LPSGT_CONFIG` ni a Supabase en el HTML

- [ ] **Step 1: Copiar app/ completo desde 11-lps-ges**
```bash
cp -r /home/user/ehchavezm-hub/11-lps-ges/app /home/user/13-gyc/app
```

- [ ] **Step 2: Eliminar vendor de Supabase y adapter de Supabase**
```bash
rm /home/user/13-gyc/app/vendor/supabase.min.js
rm /home/user/13-gyc/app/js/data/adapter-supabase.js
```

- [ ] **Step 3: Renombrar `LPSGT_CONFIG` → `GYC_CONFIG` en app/config.js**

En `app/config.js` reemplazar:
```js
// Antes:
window.LPSGT_CONFIG = { supabaseUrl: '...', supabaseAnonKey: '...' };
// Después:
window.GYC_CONFIG = { clerkPublishableKey: '', apiBase: '/api' };
```

- [ ] **Step 4: Renombrar referencias en app/index.html**

Cambiar `<title>LPS-GES</title>` → `<title>GyC</title>`, quitar `<script src="vendor/supabase.min.js">`, actualizar description meta, texto del spinner.

- [ ] **Step 5: Renombrar en app/index.html — agregar Clerk CDN**

Agregar antes del módulo principal:
```html
<script async crossorigin="anonymous"
  src="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  data-clerk-publishable-key=""
  id="clerk-js">
</script>
```
El `data-clerk-publishable-key` lo leerá `config.js` en tiempo de ejecución.

- [ ] **Step 6: Renombrar texto "LPS-GES" → "GyC" en manifest.webmanifest, sw.js, app/css/app.css**

En `app/manifest.webmanifest`: `name`, `short_name`.
En `app/sw.js`: constante de cache prefix `lpsgt-` → `gyc-`.
En `app/css/app.css`: cualquier referencia de texto.

- [ ] **Step 7: Copiar pruebas/**
```bash
cp -r /home/user/ehchavezm-hub/11-lps-ges/pruebas /home/user/13-gyc/pruebas
```

- [ ] **Step 8: Copiar migraciones y tests SQL**
```bash
mkdir -p /home/user/13-gyc/db
cp -r /home/user/ehchavezm-hub/11-lps-ges/supabase/migrations /home/user/13-gyc/db/migrations
cp -r /home/user/ehchavezm-hub/11-lps-ges/supabase/tests /home/user/13-gyc/db/tests
```

- [ ] **Step 8b: Crear `db/migrations/032_clerk_ids.sql`**

Cambia `profiles.id` y todas las FK que la referencian de `UUID` a `TEXT`, para almacenar los IDs de Clerk (`user_abc123`). El archivo debe:
1. Renombrar las columnas FK existentes a `_old`
2. Agregar las nuevas columnas como `TEXT`
3. Copiar los datos (si hay datos previos, serán UUIDs — se truncan las tablas de migración ya que GyC arranca desde cero)
4. Eliminar las columnas `_old`

```sql
-- 032_clerk_ids.sql
-- Adapta profiles.id y sus FK a TEXT para usar IDs de Clerk (user_abc123)
-- GyC arranca sin datos: las tablas que referencian profiles.id se vacían primero.
BEGIN;

-- Limpiar datos para la migración limpia (GyC es app nueva, no hay datos reales)
TRUNCATE profiles CASCADE;

-- Cambiar profiles.id a TEXT
ALTER TABLE profiles ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- Cambiar columnas que apuntan a profiles.id
ALTER TABLE actividades ALTER COLUMN creado_por TYPE TEXT USING creado_por::TEXT;
ALTER TABLE restricciones ALTER COLUMN creado_por TYPE TEXT USING creado_por::TEXT;
ALTER TABLE empresa_miembros ALTER COLUMN usuario_id TYPE TEXT USING usuario_id::TEXT;
ALTER TABLE proyecto_lideres ALTER COLUMN usuario_id TYPE TEXT USING usuario_id::TEXT;
ALTER TABLE proyecto_favoritos ALTER COLUMN usuario_id TYPE TEXT USING usuario_id::TEXT;
ALTER TABLE notificaciones ALTER COLUMN usuario_id TYPE TEXT USING usuario_id::TEXT;
ALTER TABLE auditoria ALTER COLUMN usuario_id TYPE TEXT USING usuario_id::TEXT;
ALTER TABLE organigrama_nodos ALTER COLUMN usuario_id TYPE TEXT USING usuario_id::TEXT;
ALTER TABLE delegado_historial ALTER COLUMN usuario_id TYPE TEXT USING usuario_id::TEXT;
-- (revisar migraciones 001-031 para otras columnas que referencien profiles.id)

COMMIT;
```

- [ ] **Step 9: Copiar workflows que se conservan**
```bash
mkdir -p /home/user/13-gyc/.github/workflows
cp /home/user/ehchavezm-hub/11-lps-ges/.github/workflows/pruebas.yml /home/user/13-gyc/.github/workflows/
cp /home/user/ehchavezm-hub/11-lps-ges/.github/workflows/migraciones.yml /home/user/13-gyc/.github/workflows/
```

- [ ] **Step 10: Crear .gitignore**

```
node_modules/
.env
.env.local
.vercel
*.log
```

- [ ] **Step 11: Verificar que no queden referencias a supabase en app/**
```bash
grep -r "supabase\|LPSGT_CONFIG" /home/user/13-gyc/app/ || echo "OK"
```
Expected: "OK"

- [ ] **Step 12: Commit**
```bash
cd /home/user/13-gyc
git add .
git commit -m "feat: copiar estructura base de LPS-GES y renombrar referencias a GyC"
```

---

### Task 2: Configuración Vercel + package.json raíz

**Files:**
- Create: `vercel.json`
- Create: `package.json` (raíz, para las Vercel Functions)

**Interfaces:**
- Produces: `vercel.json` con rutas que envían `/api/*` a las Functions y `/*` a `app/`; `package.json` con dependencias `@neondatabase/serverless`, `@clerk/backend`

- [ ] **Step 1: Crear vercel.json**
```json
{
  "outputDirectory": "app",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ],
  "functions": {
    "api/**/*.js": { "runtime": "nodejs20.x" }
  }
}
```

- [ ] **Step 2: Crear package.json en la raíz**
```json
{
  "name": "gyc",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "dependencies": {
    "@clerk/backend": "^1.0.0",
    "@neondatabase/serverless": "^0.10.0"
  }
}
```

- [ ] **Step 3: Instalar dependencias localmente para desarrollo**
```bash
cd /home/user/13-gyc && npm install
```

- [ ] **Step 4: Verificar que node_modules no se va a git**
```bash
grep "node_modules" /home/user/13-gyc/.gitignore
```
Expected: línea `node_modules/`

- [ ] **Step 5: Commit**
```bash
git add vercel.json package.json package-lock.json .gitignore
git commit -m "feat: agregar configuración de Vercel y dependencias de API"
```

---

### Task 3: Capa de base de datos — `api/_lib/db.js`

**Files:**
- Create: `api/_lib/db.js`

**Interfaces:**
- Produces: `export async function query(sql, params = [])` → `Promise<Row[]>`
- Produces: `export async function queryOne(sql, params = [])` → `Promise<Row | null>`
- Lee `process.env.DATABASE_URL`; lanza error descriptivo si está ausente

- [ ] **Step 1: Crear api/_lib/db.js**

```js
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export async function query(text, params = []) {
  return sql(text, params);
}

export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Escribir test manual de conexión**

Crear `api/_lib/db.test.js` (solo para desarrollo local, no se sube):
```js
// node --env-file=.env.local api/_lib/db.test.js
import { query } from './db.js';
const rows = await query('SELECT 1 AS ok');
console.assert(rows[0].ok === 1, 'Conexión a Neon fallida');
console.log('DB OK', rows[0]);
```

- [ ] **Step 3: Verificar (requiere DATABASE_URL en entorno local)**

```bash
# Solo si DATABASE_URL está disponible
DATABASE_URL="<url_neon>" node api/_lib/db.test.js
```
Expected: `DB OK { ok: 1 }`

- [ ] **Step 4: Commit**
```bash
git add api/_lib/db.js
git commit -m "feat: capa de conexión a Neon con @neondatabase/serverless"
```

---

### Task 4: Middleware de autenticación — `api/_lib/auth.js`

**Files:**
- Create: `api/_lib/auth.js`

**Interfaces:**
- Consumes: `query` de `api/_lib/db.js`
- Produces: `export async function verificarAuth(req)` → `Promise<{ userId, email, rol, areaId, esPlataforma }>` o lanza `AuthError`
- Produce: `export class AuthError extends Error { constructor(msg, status = 401) }`
- Si el usuario no tiene fila en `profiles`, la crea con `rol='pendiente'`

- [ ] **Step 1: Crear api/_lib/auth.js**

```js
import { createClerkClient } from '@clerk/backend';
import { query, queryOne } from './db.js';

export class AuthError extends Error {
  constructor(msg, status = 401) { super(msg); this.status = status; }
}

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export async function verificarAuth(req) {
  const auth = req.headers['authorization'] ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new AuthError('Sin sesión.');

  const { sub: userId, email } = await clerk.verifyToken(token)
    .catch(() => { throw new AuthError('Token inválido.'); });

  let perfil = await queryOne('SELECT * FROM profiles WHERE id = $1', [userId]);
  if (!perfil) {
    await query(
      `INSERT INTO profiles (id, email, rol, activo) VALUES ($1, $2, 'pendiente', false)
       ON CONFLICT (id) DO NOTHING`,
      [userId, email ?? '']
    );
    perfil = await queryOne('SELECT * FROM profiles WHERE id = $1', [userId]);
  }

  return {
    userId,
    email: perfil.email,
    rol: perfil.rol,
    areaId: perfil.area_id,
    esPlataforma: !!perfil.es_plataforma,
    activo: !!perfil.activo,
    perfil,
  };
}
```

- [ ] **Step 2: Verificar que AuthError tiene .status**
```js
// prueba inline
import { AuthError } from './api/_lib/auth.js';
const e = new AuthError('x', 403);
console.assert(e.status === 403, 'status incorrecto');
console.assert(e.message === 'x', 'message incorrecto');
console.log('AuthError OK');
```

- [ ] **Step 3: Commit**
```bash
git add api/_lib/auth.js
git commit -m "feat: middleware de autenticación Clerk con auto-creación de perfil en Neon"
```

---

### Task 5: Endpoints CRUD genéricos — `api/datos.js`

**Files:**
- Create: `api/datos.js`
- Create: `api/_lib/whitelist.js` (tablas y columnas permitidas)

**Interfaces:**
- Consumes: `verificarAuth` de `api/_lib/auth.js`; `query`, `queryOne` de `api/_lib/db.js`
- Produces: endpoint `POST /api/datos` que acepta `{ op, tabla, f?, cambios?, filas?, id?, nombre?, args? }`
  - `op: 'list'` → `SELECT * FROM tabla WHERE filtros`
  - `op: 'insert'` → `INSERT INTO tabla (cols) VALUES (...) RETURNING *`
  - `op: 'upsert'` → `INSERT ... ON CONFLICT (...) DO UPDATE ... RETURNING *`
  - `op: 'update'` → `UPDATE tabla SET ... WHERE id = $n RETURNING *`
  - `op: 'updateWhere'` → `UPDATE tabla SET ... WHERE filtros RETURNING *`
  - `op: 'remove'` → `DELETE FROM tabla WHERE id = $n`
  - `op: 'removeWhere'` → `DELETE FROM tabla WHERE filtros`
  - `op: 'rpc'` → llama función SQL nombrada con args

- [ ] **Step 1: Crear api/_lib/whitelist.js**

Lista exhaustiva de tablas y columnas de las migraciones SQL:
```js
export const TABLAS = new Set([
  'actividades', 'restricciones', 'cierres', 'cartera', 'proyectos', 'hitos',
  'acuerdos', 'reuniones', 'comentarios', 'enlaces', 'organigrama_nodos',
  'profiles', 'ubicaciones_dia', 'listas', 'lista_valores', 'parametros',
  'permisos', 'portafolios', 'programas', 'areas', 'plantillas',
  'plantilla_items', 'proyecto_lideres', 'proyecto_favoritos', 'vistas',
  'columnas_personalizadas', 'delegado_historial', 'notificaciones',
  'auditoria', 'pac_historico', 'empresa_miembros', 'solicitudes_cambio', 'cargos',
]);

export const RPCS_PERMITIDAS = new Set([
  'registro_abierto', 'puede', 'mi_area', 'inicializar_empresa',
  'eliminar_empresa', 'eliminar_proyecto_plataforma', 'cambiar_empresa_activa',
  'mover_a_otra_empresa',
]);

export function validarTabla(nombre) {
  if (!TABLAS.has(nombre)) throw new Error(`Tabla no permitida: ${nombre}`);
}
export function validarRpc(nombre) {
  if (!RPCS_PERMITIDAS.has(nombre)) throw new Error(`RPC no permitida: ${nombre}`);
}
```

- [ ] **Step 2: Escribir test de whitelist**
```js
import { validarTabla, validarRpc } from './api/_lib/whitelist.js';
try { validarTabla('actividades'); console.log('whitelist tabla OK'); } catch { console.error('FAIL'); }
try { validarTabla('users; DROP TABLE'); console.error('FAIL — no lanzó'); } catch { console.log('whitelist SQL injection OK'); }
```

- [ ] **Step 3: Correr el test**
```bash
node api/_lib/whitelist.js  # o node --input-type=module < test-whitelist.js
```
Expected: ambas líneas "OK"

- [ ] **Step 4: Crear api/datos.js — esqueleto con verificarAuth y dispatch**

```js
import { verificarAuth, AuthError } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { validarTabla, validarRpc } from './_lib/whitelist.js';

const ok = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const falla = (msg, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return falla('Método no permitido.', 405);
  let sesion;
  try { sesion = await verificarAuth(req); }
  catch (e) { return falla(e.message, e instanceof AuthError ? e.status : 401); }

  let d;
  try { d = await req.json(); } catch { return falla('Cuerpo inválido.'); }

  try {
    validarTabla(d.tabla ?? '');
    return ok(await despachar(d, sesion));
  } catch (e) {
    return falla(e.message, e instanceof AuthError ? e.status : 400);
  }
}

async function despachar(d, sesion) { /* Task 5 Step 5 */ }
```

- [ ] **Step 5: Implementar `despachar` en api/datos.js**

La función convierte el `op` recibido en SQL parametrizado, usando `sesion.areaId` para filtrar por `area_id` en las tablas que lo requieren. Para `op: 'rpc'` llama `validarRpc` y ejecuta `SELECT * FROM nombre(args)`. Para list con paginación usa `OFFSET`/`LIMIT`. Retorna el array/objeto de datos.

- [ ] **Step 6: Verificar con test de humo**
```bash
# Con server local de Vercel: vercel dev
# En otra terminal:
curl -X POST http://localhost:3000/api/datos \
  -H "Authorization: Bearer <token_valido>" \
  -H "Content-Type: application/json" \
  -d '{"op":"list","tabla":"actividades"}'
```
Expected: array JSON (vacío si no hay datos)

```bash
curl -X POST http://localhost:3000/api/datos \
  -H "Content-Type: application/json" \
  -d '{"op":"list","tabla":"actividades"}'
```
Expected: `{"error":"Sin sesión."}` con status 401

- [ ] **Step 7: Commit**
```bash
git add api/datos.js api/_lib/whitelist.js
git commit -m "feat: endpoint CRUD genérico /api/datos con validación de whitelist"
```

---

### Task 6: Función de administración — `api/admin-usuarios.js`

**Files:**
- Create: `api/admin-usuarios.js`

**Interfaces:**
- Consumes: `verificarAuth`; `query`, `queryOne`; Clerk backend SDK para crear/modificar usuarios
- Produces: endpoint `POST /api/admin-usuarios` que acepta `{ accion, ...datos }` — mismas acciones que la Edge Function de LPS-GES: `crear`, `clave`, `mis_empresas`, `cambiar_empresa`, `mejoras`, `gestionar_mejora`, y las acciones de plataforma

- [ ] **Step 1: Crear esqueleto de api/admin-usuarios.js**

Mismo patrón que `api/datos.js`: verificar auth, leer body, dispatch por `d.accion`.

```js
import { verificarAuth, AuthError } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const ok = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const falla = (msg, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return falla('Método no permitido.', 405);
  let sesion;
  try { sesion = await verificarAuth(req); }
  catch (e) { return falla(e.message, e instanceof AuthError ? e.status : 401); }
  const d = await req.json().catch(() => ({}));
  // dispatch por accion...
}
```

- [ ] **Step 2: Implementar acción `crear` usando Clerk backend**

`clerk.users.createUser({ emailAddress, password, firstName, lastName })` para crear la cuenta. Luego insertar/actualizar el perfil en `profiles` de Neon con el `userId` devuelto por Clerk. Mismas validaciones de rol y permisos que la Edge Function original.

- [ ] **Step 3: Implementar acción `clave` usando Clerk backend**

`clerk.users.updateUser(userId, { password })` y luego actualizar `profiles.debe_cambiar_clave` en Neon.

- [ ] **Step 4: Implementar acciones `mis_empresas` y `cambiar_empresa`**

Consultas directas a `empresa_miembros` y `areas` en Neon. Sin Clerk API (son datos de la base).

- [ ] **Step 5: Verificar que un usuario sin permiso recibe 403**
```bash
curl -X POST http://localhost:3000/api/admin-usuarios \
  -H "Authorization: Bearer <token_sin_permiso>" \
  -H "Content-Type: application/json" \
  -d '{"accion":"crear","email":"x@x.com","nombre":"X","rol":"lider","clave":"12345678"}'
```
Expected: `{"error":"No tiene permiso para gestionar usuarios."}` con status 403

- [ ] **Step 6: Commit**
```bash
git add api/admin-usuarios.js
git commit -m "feat: función admin-usuarios en Vercel con Clerk backend"
```

---

### Task 7: Adaptador de datos del browser — `app/js/data/adapter-api.js`

**Files:**
- Create: `app/js/data/adapter-api.js`

**Interfaces:**
- Consumes: `window.Clerk` (SDK browser cargado en index.html); `window.GYC_CONFIG.apiBase`
- Produces: `export function crearAdaptadorApi(apiBase)` → objeto con exactamente los mismos métodos que `crearAdaptadorSupabase`:
  - `tipo: 'api'`
  - `async list(tabla, f)` → llama POST `/api/datos` `{op:'list', tabla, f}`
  - `async insert(tabla, filas)` → `{op:'insert', tabla, filas}`
  - `async upsert(tabla, filas, onConflict)` → `{op:'upsert', tabla, filas, onConflict}`
  - `async update(tabla, id, cambios)` → `{op:'update', tabla, id, cambios}`
  - `async updateWhere(tabla, f, cambios)` → `{op:'updateWhere', tabla, f, cambios}`
  - `async remove(tabla, id)` → `{op:'remove', tabla, id}`
  - `async removeWhere(tabla, f)` → `{op:'removeWhere', tabla, f}`
  - `async rpc(nombre, args)` → `{op:'rpc', nombre, args}`
  - `async adminUsuarios(accion, datos)` → llama POST `/api/admin-usuarios`
  - `fijarArea(id)` → no-op (el server lo sabe por el perfil)
  - `subscribe(tablas, cb)` → retorna `() => {}` (no-op; sin realtime por ahora)
  - `auth: { usuario, ingresar, registrar, recuperar, cambiarClave, salir, alCambiar }` → usa `window.Clerk`

- [ ] **Step 1: Crear función de fetch autenticado**

```js
async function llamar(ruta, cuerpo) {
  const token = await window.Clerk?.session?.getToken() ?? '';
  const r = await fetch(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(cuerpo),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
```

- [ ] **Step 2: Implementar todos los métodos CRUD usando `llamar`**

Cada método llama `llamar(apiBase + '/datos', { op, tabla, ...args })`.

- [ ] **Step 3: Implementar `auth` usando window.Clerk**

```js
auth: {
  async usuario() {
    await window.Clerk?.load();
    return window.Clerk?.user ?? null;
  },
  async ingresar(email, password) {
    const si = await window.Clerk.client.signIn.create({ identifier: email, strategy: 'password', password });
    await window.Clerk.setActive({ session: si.createdSessionId });
    return window.Clerk.user;
  },
  async registrar(email, password, nombre) {
    const su = await window.Clerk.client.signUp.create({
      emailAddress: email, password,
      firstName: nombre.split(' ')[0], lastName: nombre.split(' ').slice(1).join(' ') || '',
    });
    return su;
  },
  async recuperar(email) {
    await window.Clerk.client.signIn.create({ identifier: email, strategy: 'reset_password_email_code' });
  },
  async cambiarClave(password) {
    await window.Clerk.user.updatePassword({ newPassword: password });
    await llamar(apiBase + '/datos', { op: 'update', tabla: 'profiles',
      id: window.Clerk.user.id, cambios: { debe_cambiar_clave: false } });
  },
  async salir() { await window.Clerk.signOut(); },
  alCambiar(cb) {
    window.Clerk?.addListener(({ user }) => cb(user ? 'SIGNED_IN' : 'SIGNED_OUT', user));
  },
}
```

- [ ] **Step 4: Verificar que la interfaz pública coincide con adapter-supabase**

Comparar los nombres de métodos:
```bash
grep "async \|^ *[a-z].*(" /home/user/ehchavezm-hub/11-lps-ges/app/js/data/adapter-supabase.js | sort > /tmp/iface-supabase.txt
grep "async \|^ *[a-z].*(" /home/user/13-gyc/app/js/data/adapter-api.js | sort > /tmp/iface-api.txt
diff /tmp/iface-supabase.txt /tmp/iface-api.txt
```
Expected: solo diferencias en nombres de implementación interna, no en la interfaz pública.

- [ ] **Step 5: Commit**
```bash
git add app/js/data/adapter-api.js
git commit -m "feat: adapter-api.js — capa de datos para Vercel + Clerk (misma interfaz que adapter-supabase)"
```

---

### Task 8: Actualizar `app/js/data/api.js` y `app/config.js`

**Files:**
- Modify: `app/js/data/api.js`
- Modify: `app/config.js`

**Interfaces:**
- Consumes: `crearAdaptadorApi` de `adapter-api.js`; `window.GYC_CONFIG`
- Produces: `export const api`, `export const modoDemo`, `export function mensajeError` — misma interfaz que antes

- [ ] **Step 1: Actualizar app/js/data/api.js**

Cambiar la importación y la condición de modo:
```js
import { crearAdaptadorApi } from './adapter-api.js';
import { crearAdaptadorDemo } from './adapter-demo.js';

const cfg = window.GYC_CONFIG || {};
const forzarDemo = new URLSearchParams(location.search).has('demo') || localStorage.getItem('gyc-modo') === 'demo';
export const modoDemo = forzarDemo || !cfg.clerkPublishableKey || !cfg.apiBase;
export const api = modoDemo ? crearAdaptadorDemo() : crearAdaptadorApi(cfg.apiBase);
export const apiConfigurado = !!(cfg.clerkPublishableKey && cfg.apiBase);

export function usarModo(modo) {
  if (modo === 'demo') localStorage.setItem('gyc-modo', 'demo');
  else localStorage.removeItem('gyc-modo');
  location.href = location.pathname;
}
```

- [ ] **Step 2: Actualizar mensajeError en api.js**

Quitar referencias a mensajes de Supabase Auth (`Invalid login credentials`, `Email not confirmed`, `email rate limit`, `sb_secret`). Mantener los mensajes de red, FK, duplicate key. Agregar traducciones de errores de Clerk si aplica.

- [ ] **Step 3: Actualizar referencias a `lpsgt-modo` → `gyc-modo` en la base de código**
```bash
grep -r "lpsgt-" /home/user/13-gyc/app/js/ | grep -v ".git"
```
Reemplazar todos los prefijos `lpsgt-` → `gyc-` en localStorage keys.

- [ ] **Step 4: Verificar que api.js importa correctamente**
```bash
node --input-type=module << 'EOF'
import { readFileSync } from 'fs';
const src = readFileSync('/home/user/13-gyc/app/js/data/api.js', 'utf8');
console.assert(src.includes('GYC_CONFIG'), 'GYC_CONFIG no encontrado');
console.assert(src.includes('adapter-api'), 'adapter-api no importado');
console.assert(!src.includes('supabase'), 'Supabase aún referenciado');
console.log('api.js OK');
EOF
```
Expected: `api.js OK`

- [ ] **Step 5: Commit**
```bash
git add app/js/data/api.js app/config.js
git commit -m "feat: actualizar api.js para usar GYC_CONFIG y adapter-api"
```

---

### Task 9: Actualizar `app/js/views/login.js` para Clerk

**Files:**
- Modify: `app/js/views/login.js`

**Interfaces:**
- Consumes: `window.Clerk`, `api` de `../data/api.js`
- Produces: `mostrarLogin(raiz, continuar)` — misma firma; usa el flujo de Clerk para ingresar/registrar en lugar del form manual

- [ ] **Step 1: Reemplazar form de ingreso por Clerk SignIn**

La función `mostrarLogin` en modo real:
1. Muestra el contenedor con el logo de GyC y el lema
2. Monta `window.Clerk.mountSignIn(elemento)` en un `<div id="clerk-signin">`
3. En `alCambiar`, cuando el evento es `SIGNED_IN`, llama `continuar()`

```js
export function mostrarLogin(raiz, continuar) {
  if (modoDemo) return loginDemo(raiz, continuar);
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    <div class="lema">Gestión y Construcción</div>
    <div id="clerk-signin"></div>
    <p class="nota" style="text-align:center;margin-top:10px">
      <a href="#" data-a="demo">Probar el modo demostración</a></p>
  </div></div>`);
  raiz.append(caja);
  window.Clerk?.mountSignIn(caja.querySelector('#clerk-signin'));
  api.auth.alCambiar((evento) => { if (evento === 'SIGNED_IN') continuar(); });
  caja.addEventListener('click', e => {
    if (e.target.closest('[data-a="demo"]')) { e.preventDefault(); usarModo('demo'); }
  });
}
```

- [ ] **Step 2: Simplificar `mostrarNuevaClave` — Clerk lo maneja**

Clerk gestiona el flujo de cambio de contraseña obligatorio. Mantener `mostrarNuevaClave` solo para el caso de `profiles.debe_cambiar_clave = true` que venga de la migración de datos, usando el flujo del adapter.

- [ ] **Step 3: Mantener loginDemo sin cambios**

La función `loginDemo` no depende de Clerk. Verificar que sigue funcionando:
```bash
grep "loginDemo\|usuariosDemo" /home/user/13-gyc/app/js/views/login.js
```
Expected: ambas referencias presentes.

- [ ] **Step 4: Commit**
```bash
git add app/js/views/login.js
git commit -m "feat: login.js usa Clerk SignIn component (mantiene loginDemo sin cambios)"
```

---

### Task 10: Actualizar referencias de texto en vistas + CLAUDE.md + cleanup

**Files:**
- Modify: `app/js/views/login.js`, `app/js/views/tablero.js`, y cualquier vista con texto "LPS-GES"
- Create: `CLAUDE.md`
- Delete: `.claude/` (settings de LPS-GES que no aplican)

**Interfaces:**
- Produces: sin referencias a "LPS-GES" en texto visible al usuario; CLAUDE.md actualizado para GyC

- [ ] **Step 1: Buscar referencias de texto "LPS-GES" en vistas**
```bash
grep -r "LPS-GES\|LPS\|lpsgt\|LPSGT" /home/user/13-gyc/app/js/views/ | grep -v ".git"
```

- [ ] **Step 2: Reemplazar texto visible al usuario**

En cada archivo encontrado: reemplazar `LPS-GES` → `GyC`, `LPS` (en contexto de nombre del app) → `GyC`, `lpsgt-` → `gyc-` en claves de localStorage. No tocar comentarios técnicos ni lógica de negocio.

- [ ] **Step 3: Crear CLAUDE.md para 13-GyC**

```markdown
# CLAUDE.md — GyC (Gestión y Construcción)

## 1. Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Código | GitHub `ehchavezm-hub/13-GyC` |
| Aplicativo publicado | Vercel (auto-deploy al subir a `main`) |
| Base de datos | Neon — proyecto **13-GyC** |
| Autenticación | Clerk |
| Respaldos | Neon (automáticos) |

## 2. Stack

- Frontend: SPA vanilla JS (app/), desplegada por Vercel
- Backend: Vercel Functions (api/)
- DB: Neon PostgreSQL (db/migrations/)
- Auth: Clerk

## 3. Reglas

- No tocar `11-LPS-GES` en ningún caso
- Secretos solo en Vercel Environment Variables: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`
- Las migraciones SQL las ejecuta el dueño en Neon SQL Editor
- No poner identificadores de modelos de IA en commits ni archivos

## 4. Pruebas

- `bash db/tests/run.sh` — reglas de base en Postgres local
- `bash pruebas/e2e/correr.sh` — pruebas en modo demo

## 5. Deploy

Push a `main` → Vercel despliega automáticamente.
```

- [ ] **Step 4: Eliminar .claude/ de LPS-GES si fue copiado**
```bash
rm -rf /home/user/13-gyc/.claude 2>/dev/null; echo "OK"
```

- [ ] **Step 5: Verificar que no quedan referencias a LPS-GES en texto visible**
```bash
grep -r "LPS-GES" /home/user/13-gyc/app/ | grep -v ".git" | grep -v "node_modules"
```
Expected: sin salida

- [ ] **Step 6: Commit final**
```bash
cd /home/user/13-gyc
git add .
git commit -m "feat: renombrar texto visible a GyC y actualizar CLAUDE.md"
git push -u origin main
```

---

## Resumen de archivos por tarea

| Tarea | Archivos creados / modificados |
|---|---|
| 1 | `app/` (copia), `pruebas/`, `db/migrations/`, `.github/workflows/`, `.gitignore` |
| 2 | `vercel.json`, `package.json` |
| 3 | `api/_lib/db.js` |
| 4 | `api/_lib/auth.js` |
| 5 | `api/datos.js`, `api/_lib/whitelist.js` |
| 6 | `api/admin-usuarios.js` |
| 7 | `app/js/data/adapter-api.js` |
| 8 | `app/js/data/api.js`, `app/config.js` |
| 9 | `app/js/views/login.js` |
| 10 | vistas (texto), `CLAUDE.md`, limpieza |
