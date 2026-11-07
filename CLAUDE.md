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
      api.js          Punto de entrada (único adaptador: adapter-api)
      adapter-api.js  Adaptador Vercel/Neon+Clerk (browser)
    views/
      login.js        Monta Clerk SignIn (muestra el error si Clerk no carga)
      programa-arranque.js  Checklist CR-PG-SGP-01-F1 (74 ítems)
api/
  _lib/
    db.js        Cliente Neon serverless; cada request en transacción con app.current_user_id (mi_uid())
    auth.js      Verifica JWT de Clerk; alta del perfil la primera vez (gyc_alta_usuario)
    whitelist.js Tablas permitidas y su alcance por empresa (reemplaza la RLS de Supabase)
    esquema.js   Columnas reales (information_schema): omite generadas, jsonb → JSON, '' → NULL
    usuarios.js  puede() y eliminar usuario (compartido por datos y admin-usuarios)
  datos.js      CRUD genérico (list/insert/upsert/update/updateWhere/remove/removeWhere/rpc)
  admin-usuarios.js  Usuarios (Clerk), empresas, consola de la plataforma y mejoras
db/
  migrations/   000 → 035 → … → 040 (Neon SQL Editor, en orden; 035–040 se pueden repetir)
  legado-supabase/  001–034 originales de Supabase (solo referencia; NO ejecutar en Neon)
  tests/run.sh  Prueba 000 + 035 en un PostgreSQL temporal y luego el API (pruebas/api)
pruebas/
  api/          Pruebas del API contra PostgreSQL local, servidor local y recorrido de pantallas en modo real
```

## Convenciones de código
- ES Modules (`"type": "module"` en package.json)
- Vanilla JS sin frameworks — sin React, Vue, etc.
- Sin modo demostración: el aplicativo trabaja solo con el API real
- Tres niveles de administración: 1 · Plataforma (`profiles.es_plataforma`), 2 · Empresa (rol superadmin/admin/delegado),
  3 · Proyecto (`proyecto_lideres.rol = 'administrador'`); en SQL `administra_proyecto(usuario, proyecto)`,
  en el aplicativo `esAdminPlataforma / esAdminEmpresa / esAdminProyecto` (core/store.js)
- El adaptador expone: `list, insert, upsert, update, updateWhere, remove, removeWhere, rpc, adminUsuarios, fijarArea, subscribe, auth`
- `subscribe()` es no-op (Realtime no disponible en Vercel)
- Variables de config: `window.GYC_CONFIG` (no `LPSGT_CONFIG`)
- localStorage keys: `gyc-*` (no `lpsgt-*`)
- Colores: solo la paleta Tableau (variables de `app/css/app.css` `:root`, `PALETA` en `data/catalogos.js`);
  nada de colores sueltos — los fondos suaves con `color-mix(in srgb, var(--x) 12%, #FFFFFF)`
- Toda tabla nueva que use el aplicativo debe agregarse a `api/_lib/whitelist.js` (con su alcance) y a una migración
- `api.update()` devuelve un objeto; `insert`/`upsert`/`list` devuelven arreglos (en ambos adaptadores)

## Pruebas locales (nunca contra producción)
- `bash db/tests/run.sh` — migraciones + API en un PostgreSQL temporal
- `DATABASE_URL_PRUEBAS=postgres://… node pruebas/api/servidor-local.mjs 8098 --reiniciar` y luego
  `node pruebas/api/recorrido-real.mjs` — todas las pantallas en modo real con Clerk simulado

## Despliegue
1. Vercel: conectar repo, agregar env vars `DATABASE_URL`, `CLERK_SECRET_KEY` (opcional `CLERK_JWT_KEY` para verificar sin red)
2. Neon: ejecutar en el SQL Editor, en orden: `000_gyc_neon_completo.sql`, `035_compatibilidad_api.sql`,
   `036_cuentas_preasignadas.sql`, `037_programa_arranque_r1.sql`, `038_administracion_tres_niveles.sql`,
   `039_paleta_tableau.sql`, `040_aplica.sql`
3. Clerk: copiar Publishable Key → `app/config.js` → `clerkPublishableKey` (única fuente; `config.js` carga Clerk)
4. La primera persona que ingresa queda como super administrador principal y propietaria de la plataforma;
   las siguientes quedan "pendiente" hasta que un gestor les asigne rol, salvo que su correo esté en
   `cuentas_preasignadas` (rol, empresa, principal y propietario asignados antes del primer ingreso)
