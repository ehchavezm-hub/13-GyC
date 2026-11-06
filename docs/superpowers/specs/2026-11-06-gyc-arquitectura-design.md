# GyC — Gestión y Construcción: Diseño de Arquitectura

**Fecha:** 2026-11-06  
**Base:** ehchavezm-hub/11-LPS-GES  
**Repositorio destino:** ehchavezm-hub/13-GyC

---

## 1. Resumen

GyC es una nueva aplicación web derivada de LPS-GES. Reutiliza toda la estructura de la SPA (vistas, servicios, grillas, estilos, pruebas) pero reemplaza la plataforma de backend: Supabase es sustituido por **Neon** (PostgreSQL), **Clerk** (autenticación) y **Vercel** (hosting + API). GitHub sigue siendo el repositorio de código fuente.

---

## 2. Plataformas

| Plataforma | Función | Reemplaza |
|---|---|---|
| **GitHub** | Código fuente (`ehchavezm-hub/13-GyC`) | GitHub (igual) |
| **Vercel** | Hosting de la SPA + Vercel Functions (API REST) | GitHub Pages + Supabase Edge Functions |
| **Neon** | Base de datos PostgreSQL | Supabase (PostgreSQL) |
| **Clerk** | Autenticación, usuarios y roles | Supabase Auth |

---

## 3. Arquitectura

```
Navegador (SPA — Vercel)
    │
    ├── Clerk SDK (browser)
    │     login / logout / obtener JWT
    │
    └── fetch('/api/...')
          │
          └── Vercel Functions (/api/)
                ├── valida JWT con Clerk SDK (server)
                ├── obtiene user_id y rol
                └── consulta Neon (PostgreSQL)
                      vía @neondatabase/serverless
```

El navegador **nunca accede directamente a Neon**. Toda lectura/escritura pasa por las Vercel Functions, que validan el token de Clerk antes de ejecutar cualquier SQL.

---

## 4. Estructura de carpetas

```
13-GyC/
├── app/                        ← SPA (HTML + JS ES modules)
│   ├── index.html
│   ├── config.js               ← Clerk publishable key + URL base API
│   ├── sw.js                   ← Service worker
│   ├── manifest.webmanifest
│   ├── css/
│   ├── img/
│   ├── js/
│   │   ├── core/               ← store, router, util, monitoreo
│   │   ├── data/
│   │   │   ├── api.js          ← elige adapter-api o adapter-demo
│   │   │   ├── adapter-api.js  ← NUEVO: llama a /api/* (reemplaza adapter-supabase)
│   │   │   ├── adapter-demo.js ← sin cambios (modo demostración)
│   │   │   ├── catalogos.js
│   │   │   └── demo-seed.js
│   │   ├── services/           ← sin cambios
│   │   ├── ui/                 ← sin cambios
│   │   └── views/
│   │       ├── login.js        ← REESCRITO: usa Clerk UI
│   │       └── ... resto sin cambios lógicos
│   └── vendor/                 ← tabulator, xlsx, chart, sentry (sin cambios)
│
├── api/                        ← NUEVO: Vercel Serverless Functions
│   ├── _lib/
│   │   ├── auth.js             ← valida JWT de Clerk, extrae user_id y rol
│   │   └── db.js               ← pool de conexión a Neon
│   ├── actividades.js
│   ├── proyectos.js
│   ├── restricciones.js
│   ├── cartera.js
│   ├── catalogos.js
│   ├── admin-usuarios.js       ← reemplaza supabase/functions/admin-usuarios
│   └── ... (un archivo por recurso)
│
├── db/
│   └── migrations/             ← mismo SQL de supabase/migrations/ (renombrado)
│       ├── 001_esquema.sql
│       └── ...
│
├── pruebas/                    ← sin cambios estructurales
│   ├── e2e/
│   ├── package.json
│   └── humo.mjs
│
├── docs/
│   └── superpowers/specs/
│
├── vercel.json                 ← NUEVO: config de rutas y funciones
├── package.json                ← NUEVO: dependencias de las API functions
├── .gitignore
├── CLAUDE.md
└── .github/
    └── workflows/
        ├── pruebas.yml         ← corre pruebas en cada PR (sin cambios)
        └── migraciones.yml     ← verifica SQL (sin cambios)
        (se elimina publicar.yml, respaldo.yml — Vercel y Neon lo manejan)
```

---

## 5. Componentes nuevos / reescritos

### 5.1 `app/config.js`
```js
window.GYC_CONFIG = {
  clerkPublishableKey: 'pk_...',
  apiBase: '/api',               // Vercel Functions, mismo origen
};
```

### 5.2 `app/js/data/adapter-api.js`
Reemplaza `adapter-supabase.js`. Hace `fetch` a los endpoints de `/api/`, adjuntando el JWT de Clerk en el header `Authorization: Bearer <token>`. Mantiene la misma interfaz que el adapter anterior para que el resto del código no cambie.

### 5.3 `api/_lib/auth.js`
Valida el JWT de Clerk usando `@clerk/backend`. Extrae `userId`, `orgId` y `rol` del claim. Rechaza con 401 si el token es inválido o ausente.

### 5.4 `api/_lib/db.js`
Crea y reutiliza un pool de conexión a Neon usando `@neondatabase/serverless`. La URL de conexión viene de la variable de entorno `DATABASE_URL` (configurada en Vercel, nunca en el código).

### 5.5 `app/js/views/login.js`
Reescrito para usar el componente de Clerk (`<SignIn />`). El resto del flujo de sesión (detectar si está logueado, obtener datos del usuario) usa el SDK de Clerk para browser.

### 5.6 `vercel.json`
Configura las rutas: todo lo que empiece en `/api/` va a las Vercel Functions; el resto sirve la SPA desde `app/`.

---

## 6. Migraciones SQL

Las migraciones de `supabase/migrations/` se copian a `db/migrations/` sin cambios de SQL. Neon es PostgreSQL puro y ejecuta las mismas sentencias.

**Diferencia clave:** la seguridad ya no depende de RLS en la base de datos. Las políticas de acceso se aplican en las Vercel Functions (filtros SQL según el `userId` y `rol` obtenidos del JWT de Clerk). Las políticas RLS del SQL se pueden mantener como capa adicional o simplificar progresivamente.

---

## 7. Autenticación y roles

Clerk maneja el ciclo completo: registro, login, reset de contraseña, emails transaccionales. Los roles (`admin`, `planificador`, `lider`, etc.) se guardan en Clerk como `publicMetadata.rol` y se sincronizan con la tabla `profiles` de Neon al primer login (webhook de Clerk → Vercel Function).

---

## 8. Deploy

| Acción | Resultado |
|---|---|
| Push a `main` | Vercel despliega automáticamente |
| Push a rama | Vercel crea un preview URL |
| Migraciones SQL | El dueño las ejecuta en el SQL Editor de Neon |
| Variables secretas | Se guardan en Vercel Environment Variables (nunca en el código) |

---

## 9. Variables de entorno requeridas (en Vercel)

| Variable | Contenido |
|---|---|
| `DATABASE_URL` | URL de conexión a Neon (con pooler) |
| `CLERK_SECRET_KEY` | Clave secreta de Clerk (server-side) |
| `CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk (también en `config.js`) |

---

## 10. Lo que no cambia

- Toda la lógica de negocio: vistas, servicios, grillas (Tabulator), Excel (SheetJS), PDF, indicadores, reportes, Backlog, Look Ahead, Plan, Restricciones, Cartera, Organigrama.
- Modo demostración (`?demo`): `adapter-demo.js` y `demo-seed.js` sin cambios.
- Pruebas E2E (`pruebas/`): corren contra la SPA en modo demo, no necesitan cambios de plataforma.
- Vendor libraries: Tabulator, SheetJS, Chart.js, Sentry (opcional).
- Estructura de carpetas de la SPA (`app/js/views/`, `app/js/services/`, etc.).
