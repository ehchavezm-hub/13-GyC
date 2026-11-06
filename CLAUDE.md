# GyC — Gestión y Construcción

## Repositorio y stack
- Repo: `ehchavezm-hub/13-GyC`
- Frontend: Vanilla JS SPA en `app/` → desplegado en **Vercel**
- API: Vercel Functions en `api/`
- Base de datos: **Neon** (PostgreSQL serverless, región São Paulo)
- Autenticación: **Clerk** (app `app_3LkJhHBwO0USuhubaxJto8YISJM`)

## Reglas estrictas
1. **Nunca tocar** el repositorio `ehchavezm-hub/11-LPS-GES`
2. **Nunca exponer** `DATABASE_URL` ni `CLERK_SECRET_KEY` en el frontend ni en el código
3. Los secretos solo van en **Vercel Environment Variables** y en las credenciales del entorno en la nube
4. Las **migraciones SQL** las ejecuta el dueño en el SQL Editor de Neon — no correr `psql` ni drivers contra producción
5. No incluir identificadores de modelos de IA en commits, PRs ni archivos del repositorio

## Estructura
```
app/           Frontend (HTML/CSS/JS puro)
  config.js    window.GYC_CONFIG = { clerkPublishableKey, apiBase }
  js/
    data/
      api.js          Punto de entrada — elige adapter-api o adapter-demo
      adapter-api.js  Adaptador Vercel/Neon+Clerk (browser)
      adapter-demo.js Adaptador demostración (localStorage)
    views/
      login.js        Monta Clerk SignIn o selector demo
      programa-arranque.js  Checklist CR-PG-SGP-01-F1 (74 ítems)
api/
  _lib/
    db.js       Cliente Neon serverless (@neondatabase/serverless)
    auth.js     Verifica JWT de Clerk
    whitelist.js Tablas permitidas para evitar inyección SQL
  datos.js      CRUD genérico (list/insert/upsert/update/remove/rpc)
  admin-usuarios.js  Gestión de usuarios (solo admin/superadmin)
db/
  migrations/   001–034 archivos SQL — correr en orden en Neon SQL Editor
```

## Convenciones de código
- ES Modules (`"type": "module"` en package.json)
- Vanilla JS sin frameworks — sin React, Vue, etc.
- El adaptador expone: `list, insert, upsert, update, updateWhere, remove, removeWhere, rpc, adminUsuarios, fijarArea, subscribe, auth`
- `subscribe()` es no-op (Realtime no disponible en Vercel)
- Variables de config: `window.GYC_CONFIG` (no `LPSGT_CONFIG`)
- localStorage keys: `gyc-*` (no `lpsgt-*`)

## Despliegue
1. Vercel: conectar repo, agregar env vars `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`
2. Neon: ejecutar migraciones `db/migrations/001_*.sql` … `034_*.sql` en orden en el SQL Editor
3. Clerk: copiar Publishable Key → `app/config.js` → `clerkPublishableKey`
