# Legado Supabase (no ejecutar en Neon)

Estas migraciones (001–034) y pruebas son las del aplicativo original sobre **Supabase**: usan `auth.users`,
`auth.uid()`, roles `anon`/`authenticated` y seguridad por filas (RLS), que **no existen en Neon**.
Se conservan solo como referencia histórica de las reglas de negocio.

La base de GyC en Neon se crea con `db/migrations/000_gyc_neon_completo.sql` (que ya incluye lo de 001–034,
adaptado a Clerk) y `db/migrations/035_compatibilidad_api.sql`.
